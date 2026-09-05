# Prueba Técnica — Data & AI Engineer | Grenergy

Pipeline ETL en Microsoft Fabric para la ingesta de precios Day-Ahead de electricidad de España, Rumanía, Alemania y Polonia, con exposición vía API REST e interfaz de visualización.

## Tabla de contenidos

- [Arquitectura](#arquitectura)
- [Decisiones técnicas](#decisiones-técnicas)
- [Retos específicos por API y cómo se resolvieron](#retos-específicos-por-api-y-cómo-se-resolvieron)
- [Cómo reproducir la solución](#cómo-reproducir-la-solución)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Limitaciones conocidas](#limitaciones-conocidas)

---

## Arquitectura

### Fase 1 — Ingesta (Microsoft Fabric)

El pipeline sigue un diseño basado en los principios **SOLID**, pensado para que añadir un país nuevo sea una cuestión de configuración, no de reescritura de código.

```
COUNTRY_CONFIG (dict de configuración)
        │
        ▼
┌─────────────────────┐
│  ConnectorFactory     │  → decide qué conector instanciar según "source"
└─────────────────────┘
        │
        ▼
┌─────────────────────┐        ┌──────────────────────┐
│  SourceConnector (ABC)│◄───── │ EntsoeConnector        │ (ES, RO)
│  fetch(date) -> list  │◄───── │ SmardConnector         │ (DE)
└─────────────────────┘◄───── │ PseConnector           │ (PL)
                                └──────────────────────┘
        │
        ▼
┌─────────────────────┐
│ IngestionOrchestrator │  → fetch → conversión moneda → PriceRecord → MERGE en Delta
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│ CurrencyConverter (ABC)│◄──── NbpCurrencyConverter (PLN → EUR, API oficial NBP)
└─────────────────────┘
        │
        ▼
   Tablas Delta separadas por país en el Lakehouse
   (es_day_ahead, ro_day_ahead, de_day_ahead, pl_day_ahead)
        │
        ▼
   Data Pipeline con trigger diario (Notebook activity + schedule)
```

**Principios SOLID aplicados:**

| Principio | Aplicación concreta |
|---|---|
| **S**ingle Responsibility | Cada conector solo sabe hablar con su API. La conversión de moneda vive aparte (`CurrencyConverter`). La escritura en Delta vive aparte (`_write_merge`). El orquestador solo coordina. |
| **O**pen/Closed | Añadir un país con una fuente ya soportada = una entrada nueva en `COUNTRY_CONFIG`. Cero cambios en `ConnectorFactory`, `IngestionOrchestrator` ni el resto de clases. |
| **L**iskov Substitution | Todos los conectores implementan el mismo contrato (`SourceConnector.fetch()`); el orquestador nunca necesita saber si está hablando con ENTSO-E, SMARD o PSE. |
| **I**nterface Segregation | `SourceConnector` y `CurrencyConverter` son interfaces pequeñas y enfocadas, cada una con una única responsabilidad. |
| **D**ependency Inversion | `IngestionOrchestrator` depende de las abstracciones (`SourceConnector`, `CurrencyConverter`), no de las implementaciones concretas. Se inyectan vía constructor/Factory. |

### Modelo de datos normalizado

Todas las fuentes convergen en un único esquema (`PriceRecord`), independiente de si el origen era XML o JSON:

| Campo | Tipo | Descripción |
|---|---|---|
| `country` | string | Código ISO del país (ES, RO, DE, PL) |
| `datetime_utc` | timestamp | Timestamp normalizado a UTC, convención "inicio de intervalo" |
| `price_eur` | float | Precio ya convertido a EUR/MWh |
| `granularity_minutes` | int | 15 (ES/RO/PL) o 60 (DE) |
| `source` | string | Fuente de origen (entsoe / smard / pse), para trazabilidad |
| `ingestion_ts` | timestamp | Momento de ingesta, para auditoría |

---

## Decisiones técnicas

### 1. Diseño escalable vía configuración, no hardcodeo

Toda la información variable por país (dominio EIC, filtro SMARD, moneda, granularidad) vive en un único diccionario `COUNTRY_CONFIG`. El `ConnectorFactory` es el único punto que traduce esa configuración en un conector concreto. Esto cumple el requisito del PDF de "incorporar nuevos países sin reescribir el pipeline".

### 2. Idempotencia mediante MERGE sobre `datetime_utc`

Cada escritura en las tablas Delta usa `MERGE INTO ... ON target.datetime_utc = source.datetime_utc`, con `UPDATE SET *` en caso de coincidencia e `INSERT *` en caso contrario. Esto garantiza que:
- Reejecutar la ingesta del mismo día no genera duplicados.
- Las correcciones/revisiones publicadas posteriormente por las fuentes se reflejan correctamente (sobrescriben el valor anterior).

**Verificado empíricamente:** se ejecutó el pipeline dos veces consecutivas para el mismo día y se confirmó que el conteo de registros se mantuvo estable (96 en ambos casos para España), no se duplicó.

### 3. Conversión de moneda: NBP (Narodowy Bank Polski)

Se eligió la API oficial del banco central de Polonia (`api.nbp.pl`) para la conversión PLN→EUR, por ser una fuente oficial, gratuita y sin necesidad de autenticación. Se aplica el tipo de cambio correspondiente **a la fecha del precio**, no al momento de la ingesta, para mantener coherencia histórica. Se implementó un fallback automático al día hábil anterior cuando el NBP no publica cotización (fines de semana/festivos), y un caché en memoria (`lru_cache`) para evitar llamadas repetidas dentro de la misma ejecución.

### 4. Parametrización de fecha para automatización

El notebook recibe la fecha objetivo como parámetro externo (`run_date_str`, celda de parámetros de Fabric), en vez de tenerla hardcodeada. El Data Pipeline inyecta dinámicamente `@formatDateTime(addDays(utcNow(), 1), 'yyyy-MM-dd')` — es decir, pide **el día siguiente** respecto al momento de ejecución, porque los mercados Day-Ahead europeos publican el precio del día D durante la tarde de D-1. El trigger diario está programado para ejecutarse después de la ventana de publicación (12:00–14:00 CET aprox.), garantizando que los datos ya estén disponibles en las 4 fuentes al momento de la ingesta.

### 5. Manejo de huecos en la fuente: fidelidad sobre completitud

Durante el backfill se detectaron discrepancias entre los registros esperados y los realmente ingeridos en ciertos días (ver sección de retos específicos). Se investigó mediante inspección directa del XML crudo de ENTSO-E y se confirmó que los huecos existen en **todas las revisiones publicadas por la fuente**, no son un error de parseo.

**Decisión:** el pipeline no interpola ni rellena estos huecos artificialmente. Se prioriza la fidelidad a los datos de origen sobre la completitud aparente. La responsabilidad de comunicar visualmente los huecos (discontinuidades en gráficas) se delega a la capa de visualización (Fase 2).

### 6. Gestión del token de ENTSO-E

Para esta prueba técnica el token se mantiene como variable en el notebook por simplicidad. En un entorno productivo real, se recomendaría almacenarlo en **Azure Key Vault** (Fabric tiene conector nativo) en vez de hardcodearlo en el código.

---

## Retos específicos por API y cómo se resolvieron

Estos tres hallazgos surgieron durante el desarrollo mediante inspección directa de las respuestas reales de cada API, no solo de la documentación:

### ENTSO-E — Revisiones duplicadas del mismo día

**Problema:** una única llamada para un día devolvía hasta 6 `TimeSeries` distintos, con el mismo rango de fechas pero distinto número de puntos — ENTSO-E republica correcciones intradiarias del mercado.

**Solución:** deduplicación por `datetime_utc` usando un diccionario donde el último `TimeSeries` procesado sobrescribe versiones anteriores para el mismo timestamp ("last write wins"), asumiendo que el orden de aparición en el XML refleja el orden cronológico de publicación.

### ENTSO-E — Redondeo de ventana a día de mercado local

**Problema:** al pedir el rango UTC de un día calendario, la API devolvía el doble de registros esperados (192 en vez de 96), porque ENTSO-E redondea la ventana solicitada a días de mercado completos según la zona horaria local del país (España en CEST = UTC+2), y la ventana pedida cruzaba la frontera entre dos días de mercado.

**Solución:** filtrado explícito post-parseo, quedándonos únicamente con los registros cuyo `datetime_utc` cae dentro del día UTC exacto solicitado, sin depender de que la API devuelva exactamente ese rango.

### PSE — Convención de timestamp invertida

**Problema:** los timestamps devueltos por PSE representan el **fin** de cada intervalo de 15 minutos, no el inicio (a diferencia de ENTSO-E y SMARD, que usan inicio de intervalo). Esto se detectó comparando el primer y último registro del día contra el rango esperado.

**Solución:** se resta la granularidad (15 min) a cada timestamp de PSE al parsear, homogeneizando la convención con las demás fuentes — necesario para que la comparativa multi-país de la Fase 2 alinee correctamente las franjas horarias.

### SMARD — Verificación de zona horaria

Se verificó que los timestamps epoch de SMARD representan UTC real (no hora local disfrazada de epoch), por lo que no requirieron ajuste adicional más allá de la conversión estándar `datetime.utcfromtimestamp()`.

---

## Cómo reproducir la solución

### Requisitos previos

- Acceso a un workspace de Microsoft Fabric con capacidad Trial (o superior) asignada.
- Token de acceso a ENTSO-E Transparency Platform.

### Variables de entorno / configuración

Definidas en la celda de configuración del notebook:

```python
ENTSOE_TOKEN = "<tu-token-de-entsoe>"

COUNTRY_CONFIG = {
    "ES": {"source": "entsoe", "domain": "10YES-REE------0", "currency": "EUR", "granularity_minutes": 15},
    "RO": {"source": "entsoe", "domain": "10YRO-TEL------P", "currency": "EUR", "granularity_minutes": 15},
    "DE": {"source": "smard", "region": "DE", "filter": "4169", "currency": "EUR", "granularity_minutes": 60},
    "PL": {"source": "pse", "currency": "PLN", "granularity_minutes": 15},
}
```

### Pasos de ejecución

1. **Crear el workspace en Fabric** y asignarle la capacidad Trial.
2. **Crear un Lakehouse** (ej. `day_ahead_prices`) para almacenar las tablas Delta.
3. **Crear un Notebook** y vincularlo al Lakehouse como contexto por defecto.
4. **Pegar el código** de los módulos en el orden: modelo de datos → conversor de divisa → conectores → factory → orquestador.
5. **Ejecución manual (single day):**
   ```python
   converter = NbpCurrencyConverter()
   orchestrator = IngestionOrchestrator(spark=spark, currency_converter=converter, entsoe_token=ENTSOE_TOKEN)
   target_date = datetime.strptime(run_date_str, "%Y-%m-%d")

   for country_code, config in COUNTRY_CONFIG.items():
       orchestrator.run_for_country(country_code, config, target_date)
   ```
6. **Backfill histórico (rango de días):**
   ```python
   orchestrator.run_backfill(country_code, config, start_date, end_date)
   ```
7. **Automatización:** crear un Data Pipeline con una actividad Notebook apuntando a este notebook, parámetro `run_date_str` con la expresión dinámica `@formatDateTime(addDays(utcNow(), 1), 'yyyy-MM-dd')`, y programar un trigger diario después de la ventana de publicación de precios (recomendado: 14:00–16:00 CET).

### Verificación

```python
spark.sql("SELECT COUNT(*) FROM es_day_ahead").show()
spark.sql("SELECT MIN(datetime_utc), MAX(datetime_utc) FROM es_day_ahead").show()
```

---

## Estructura del repositorio

```
├── README.md                          # este documento
├── notebooks/
│   └── ingest_day_ahead.ipynb         # notebook de ingesta (Fase 1)
├── api/                                # API REST (Fase 2)
├── frontend/                           # interfaz web (Fase 2)
└── docs/
    └── decisiones_tecnicas.md          # ampliación de este README si aplica
```

## Limitaciones conocidas

- No se cubre el caso de caída total de una fuente durante una ventana prolongada (más allá de reintentos básicos); en producción se recomendaría añadir reintentos con backoff exponencial y alertas.
- El token de ENTSO-E se gestiona como variable plana en el notebook para esta prueba; en producción debería vivir en Azure Key Vault.
- Los huecos de datos detectados en la fuente ENTSO-E para franjas horarias puntuales no se interpolan (ver [Decisiones técnicas](#5-manejo-de-huecos-en-la-fuente-fidelidad-sobre-completitud)).
