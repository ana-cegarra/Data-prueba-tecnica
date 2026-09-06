Prueba Técnica — Data & AI Engineer

Pipeline ETL en Microsoft Fabric para la ingesta de precios Day-Ahead de electricidad de España, Rumanía, Alemania y Polonia, con exposición vía API REST e interfaz de visualización.

🔗 Interfaz desplegada: https://data-prueba-tecnica.vercel.app (la primera carga puede tardar hasta 60s si la API estuvo inactiva — ver Despliegue en producción)

Todos los precios se normalizan y presentan en EUR/MWh, independientemente de la moneda de origen (Polonia publica en PLN; el resto ya en EUR), mediante conversión con el tipo de cambio oficial diario del banco central polaco (NBP) — ver Decisión técnica #3.

Tabla de contenidos
Arquitectura
Decisiones técnicas
Retos específicos por API y cómo se resolvieron
Cómo reproducir la solución
Estructura del repositorio
Limitaciones conocidas
Arquitectura
Fase 1 — Ingesta (Microsoft Fabric)

El pipeline sigue un diseño basado en los principios SOLID, pensado para que añadir un país nuevo sea una cuestión de configuración, no de reescritura de código.

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

Principios SOLID aplicados:

Principio	Aplicación concreta
Single Responsibility	Cada conector solo sabe hablar con su API. La conversión de moneda vive aparte (CurrencyConverter). La escritura en Delta vive aparte (_write_merge). El orquestador solo coordina.
Open/Closed	Añadir un país con una fuente ya soportada = una entrada nueva en COUNTRY_CONFIG. Cero cambios en ConnectorFactory, IngestionOrchestrator ni el resto de clases.
Liskov Substitution	Todos los conectores implementan el mismo contrato (SourceConnector.fetch()); el orquestador nunca necesita saber si está hablando con ENTSO-E, SMARD o PSE.
Interface Segregation	SourceConnector y CurrencyConverter son interfaces pequeñas y enfocadas, cada una con una única responsabilidad.
Dependency Inversion	IngestionOrchestrator depende de las abstracciones (SourceConnector, CurrencyConverter), no de las implementaciones concretas. Se inyectan vía constructor/Factory.
Fase 2 — API REST + Interfaz Web
┌──────────────────┐         ┌─────────────────────┐         ┌──────────────────┐
│  React Frontend    │ ──────► │  FastAPI (API REST)   │ ──────► │  CSVs exportados   │
│  (Vite + Recharts) │  HTTP   │  api/main.py           │  lee   │  api/data/*.csv     │
│                    │◄────── │  + API Key en header   │◄────── │  (desde Fabric)     │
└──────────────────┘  JSON   └─────────────────────┘         └──────────────────┘

Backend (api/):

main.py — endpoints FastAPI (/health, /countries, /prices, /prices/compare)
security.py — validación de API Key vía header X-API-Key (dependencia de FastAPI)
data_repository.py — única responsabilidad: leer y cachear los CSVs (PriceDataRepository), aislando al resto de la API de saber que los datos vienen de archivos y no de una base de datos en vivo

Frontend (frontend/):

src/api/client.js — cliente HTTP centralizado (axios), única pieza que conoce la URL/autenticación de la API
src/components/ControlPanel.jsx — selector de países y rango de fechas
src/components/PriceChart.jsx — gráfica de un solo país
src/components/ComparisonChart.jsx — comparativa multi-país, con normalización de granularidad (ver decisión técnica más abajo)
Modelo de datos normalizado

Todas las fuentes convergen en un único esquema (PriceRecord), independiente de si el origen era XML o JSON:

Campo	Tipo	Descripción
country	string	Código ISO del país (ES, RO, DE, PL)
datetime_utc	timestamp	Timestamp normalizado a UTC, convención "inicio de intervalo"
price_eur	float	Precio ya convertido a EUR/MWh
granularity_minutes	int	15 (ES/RO/PL) o 60 (DE)
source	string	Fuente de origen (entsoe / smard / pse), para trazabilidad
ingestion_ts	timestamp	Momento de ingesta, para auditoría
Decisiones técnicas
1. Diseño escalable vía configuración, no hardcodeo

Toda la información variable por país (dominio EIC, filtro SMARD, moneda, granularidad) vive en un único diccionario COUNTRY_CONFIG. El ConnectorFactory es el único punto que traduce esa configuración en un conector concreto. Esto cumple el requisito del PDF de "incorporar nuevos países sin reescribir el pipeline".

2. Idempotencia mediante MERGE sobre datetime_utc

Cada escritura en las tablas Delta usa MERGE INTO ... ON target.datetime_utc = source.datetime_utc, con UPDATE SET * en caso de coincidencia e INSERT * en caso contrario. Esto garantiza que:

Reejecutar la ingesta del mismo día no genera duplicados.
Las correcciones/revisiones publicadas posteriormente por las fuentes se reflejan correctamente (sobrescriben el valor anterior).

Verificado empíricamente: se ejecutó el pipeline dos veces consecutivas para el mismo día y se confirmó que el conteo de registros se mantuvo estable (96 en ambos casos para España), no se duplicó.

3. Conversión de moneda: NBP (Narodowy Bank Polski)

Se eligió la API oficial del banco central de Polonia (api.nbp.pl) para la conversión PLN→EUR, por ser una fuente oficial, gratuita y sin necesidad de autenticación. Se aplica el tipo de cambio correspondiente a la fecha del precio, no al momento de la ingesta, para mantener coherencia histórica. Se implementó un fallback automático al día hábil anterior cuando el NBP no publica cotización (fines de semana/festivos), y un caché en memoria (lru_cache) para evitar llamadas repetidas dentro de la misma ejecución.

Con esto, el campo price_eur en las 4 tablas (es_day_ahead, ro_day_ahead, de_day_ahead, pl_day_ahead) queda siempre en la misma unidad monetaria, cumpliendo el punto valorado en el enunciado de "presentar todos los datos en EUR" — tanto en el pipeline de ingesta como en la API y la interfaz, que consumen directamente ese campo ya normalizado.

4. Parametrización de fecha para automatización

El notebook recibe la fecha objetivo como parámetro externo (run_date_str, celda de parámetros de Fabric), en vez de tenerla hardcodeada. El Data Pipeline inyecta dinámicamente @formatDateTime(addDays(utcNow(), 1), 'yyyy-MM-dd') — es decir, pide el día siguiente respecto al momento de ejecución, porque los mercados Day-Ahead europeos publican el precio del día D durante la tarde de D-1. El trigger diario está programado para ejecutarse después de la ventana de publicación (12:00–14:00 CET aprox.), garantizando que los datos ya estén disponibles en las 4 fuentes al momento de la ingesta.

5. Manejo de huecos en la fuente: fidelidad sobre completitud

Durante el backfill se detectaron discrepancias entre los registros esperados y los realmente ingeridos en ciertos días (ver sección de retos específicos). Se investigó mediante inspección directa del XML crudo de ENTSO-E y se confirmó que los huecos existen en todas las revisiones publicadas por la fuente, no son un error de parseo.

Decisión: el pipeline no interpola ni rellena estos huecos artificialmente. Se prioriza la fidelidad a los datos de origen sobre la completitud aparente. La responsabilidad de comunicar visualmente los huecos (discontinuidades en gráficas) se delega a la capa de visualización (Fase 2).

6. Gestión del token de ENTSO-E

Para esta prueba técnica el token se mantiene como variable en el notebook por simplicidad. En un entorno productivo real, se recomendaría almacenarlo en Azure Key Vault (Fabric tiene conector nativo) en vez de hardcodearlo en el código.

7. Exportación a CSV en vez de conexión en vivo al SQL Analytics Endpoint

La arquitectura original planteaba que la API se conectara en vivo al SQL Analytics Endpoint que Fabric genera automáticamente para el Lakehouse. Al implementarlo, se encontró que el tenant de Fabric utilizado tiene políticas de Conditional Access de Azure AD que bloquean la autenticación interactiva (probados los métodos ActiveDirectoryInteractive, ActiveDirectoryDeviceCode, y obtención de token vía azure-identity) desde aplicaciones no aprobadas explícitamente por el administrador del tenant — ver Retos específicos.

Decisión: el propio notebook de Fabric (donde la autenticación ya funciona porque corre dentro del tenant) exporta las tablas Delta a CSV dentro de Files/exports/ del Lakehouse. Estos CSVs se descargan manualmente a api/data/ y la API los lee desde ahí. Es una solución pragmática dada la restricción de infraestructura, documentada explícitamente en vez de forzar una conexión que la organización no permite.

Limitación de esta decisión: los datos no se actualizan en tiempo real; requiere re-exportar y descargar los CSVs periódicamente. En un entorno productivo real, se resolvería solicitando al administrador del tenant que apruebe el consentimiento de la aplicación, o usando una Service Principal con permisos concedidos explícitamente por IT.

8. Seguridad de la API: API Key en header

Se implementó autenticación vía API Key en el header X-API-Key, validada como dependencia de FastAPI (security.py) en cada endpoint que expone datos. Se eligió esta opción, frente a alternativas como OAuth2/JWT, por ser:

Suficiente para el contexto de uso (herramienta interna/demo, sin necesidad de gestión de usuarios ni roles diferenciados)
Simple de implementar y de consumir tanto desde Swagger como desde el frontend
Fácil de rotar (cambiar el valor en .env invalida el acceso anterior inmediatamente)

Limitación conocida: en el frontend, la API Key se expone en el bundle de JavaScript que llega al navegador (cualquier variable VITE_* es visible vía DevTools). Esto es aceptable para una demo local, pero en producción requeriría un backend intermedio que oculte la clave, o un esquema de autenticación de usuario real (OAuth2, sesiones).

9. Normalización de granularidad para la comparativa multi-país

Para superponer en una misma gráfica países con PT15M (España, Rumanía, Polonia) y PT60M (Alemania), el frontend remuestrea todos los países a promedios horarios antes de graficar (ComparisonChart.jsx, función mergeToHourlyBuckets). Esto alinea el eje temporal sin inventar datos: donde una fuente no tiene valor para una hora concreta (por los huecos documentados en la sección anterior), el punto queda como null, lo que Recharts renderiza como una discontinuidad visible en la línea (connectNulls={false}), consistente con la decisión de "fidelidad sobre completitud" del pipeline de ingesta.

La vista de "detalle por país" (PriceChart.jsx) muestra los datos en su granularidad nativa (sin remuestrear), indicando explícitamente el intervalo (15min / 60min) y el número de puntos junto al título de cada gráfica.

10. Despliegue público en plataformas gratuitas

El enunciado permite que la solución funcione únicamente en local ("no es necesario un despliegue en producción, aunque se valorará positivamente"). Se optó por desplegar igualmente, usando exclusivamente planes gratuitos sin coste ni necesidad de tarjeta de crédito:

Render (Free tier) para la API — elegido sobre Railway, cuyo plan de prueba gratuito consume un crédito limitado de un solo uso.
Vercel (Hobby, gratuito permanente para proyectos no comerciales) para el frontend estático generado por Vite.

Esta decisión implica aceptar la limitación de "cold start" de Render en su plan gratuito (ver sección de reproducción), considerada un compromiso razonable frente al coste de un plan de pago para una prueba técnica de alcance acotado.

Retos específicos por API y cómo se resolvieron

Estos tres hallazgos surgieron durante el desarrollo mediante inspección directa de las respuestas reales de cada API, no solo de la documentación:

ENTSO-E — Revisiones duplicadas del mismo día

Problema: una única llamada para un día devolvía hasta 6 TimeSeries distintos, con el mismo rango de fechas pero distinto número de puntos — ENTSO-E republica correcciones intradiarias del mercado.

Solución: deduplicación por datetime_utc usando un diccionario donde el último TimeSeries procesado sobrescribe versiones anteriores para el mismo timestamp ("last write wins"), asumiendo que el orden de aparición en el XML refleja el orden cronológico de publicación.

ENTSO-E — Redondeo de ventana a día de mercado local

Problema: al pedir el rango UTC de un día calendario, la API devolvía el doble de registros esperados (192 en vez de 96), porque ENTSO-E redondea la ventana solicitada a días de mercado completos según la zona horaria local del país (España en CEST = UTC+2), y la ventana pedida cruzaba la frontera entre dos días de mercado.

Solución: filtrado explícito post-parseo, quedándonos únicamente con los registros cuyo datetime_utc cae dentro del día UTC exacto solicitado, sin depender de que la API devuelva exactamente ese rango.

PSE — Convención de timestamp invertida

Problema: los timestamps devueltos por PSE representan el fin de cada intervalo de 15 minutos, no el inicio (a diferencia de ENTSO-E y SMARD, que usan inicio de intervalo). Esto se detectó comparando el primer y último registro del día contra el rango esperado.

Solución: se resta la granularidad (15 min) a cada timestamp de PSE al parsear, homogeneizando la convención con las demás fuentes — necesario para que la comparativa multi-país de la Fase 2 alinee correctamente las franjas horarias.

SMARD — Verificación de zona horaria

Se verificó que los timestamps epoch de SMARD representan UTC real (no hora local disfrazada de epoch), por lo que no requirieron ajuste adicional más allá de la conversión estándar datetime.utcfromtimestamp().

Fabric — Restricción de Conditional Access en el tenant

Problema: al intentar conectar la API REST directamente al SQL Analytics Endpoint del Lakehouse (autenticación Azure AD), todos los métodos de autenticación interactiva probados (ActiveDirectoryInteractive, ActiveDirectoryDeviceCode vía ODBC, y obtención de token vía azure-identity con DeviceCodeCredential) fueron rechazados por el tenant con el error "No tiene permiso para acceder a este recurso [...] flujo de autenticación restringido por su administrador". Esto es consistente con otra restricción observada anteriormente en el mismo tenant (creación de workspaces de Fabric deshabilitada para el usuario de prueba).

Diagnóstico: política de Conditional Access de Azure AD que bloquea aplicaciones/flujos no aprobados explícitamente por el administrador del tenant — no es un error de configuración del lado del código, sino una restricción de seguridad organizacional intencional.

Solución: ver Decisión técnica #7 — exportación periódica a CSV desde dentro del propio notebook de Fabric (donde la autenticación de sesión ya es válida), en vez de una conexión en vivo desde fuera del tenant.

Cómo reproducir la solución
Requisitos previos
Acceso a un workspace de Microsoft Fabric con capacidad Trial (o superior) asignada.
Token de acceso a ENTSO-E Transparency Platform.
Variables de entorno / configuración

El notebook lee el token de ENTSO-E desde una variable de entorno, en vez de tenerlo hardcodeado:

python
import os
ENTSOE_TOKEN = os.environ.get("ENTSOE_TOKEN")

Antes de ejecutar el notebook, define esta variable de entorno con tu propio token de ENTSO-E:

En Fabric: puedes definirla al inicio del notebook con os.environ["ENTSOE_TOKEN"] = "<tu-token>" en una celda separada que no subas al repositorio (o usa Azure Key Vault, ver Decisiones técnicas), o configúrala como variable de entorno del entorno de Spark del workspace.
En local (si migras el notebook a Jupyter): export ENTSOE_TOKEN="<tu-token>" en la terminal antes de lanzar Jupyter, o usa un archivo .env con python-dotenv.

Si ENTSOE_TOKEN no está definida, os.environ.get("ENTSOE_TOKEN") devuelve None y las llamadas a la API de ENTSO-E fallarán con un error de autenticación — es la señal de que falta este paso.

El resto de la configuración por país:

python
COUNTRY_CONFIG = {
    "ES": {"source": "entsoe", "domain": "10YES-REE------0", "currency": "EUR", "granularity_minutes": 15},
    "RO": {"source": "entsoe", "domain": "10YRO-TEL------P", "currency": "EUR", "granularity_minutes": 15},
    "DE": {"source": "smard", "region": "DE", "filter": "4169", "currency": "EUR", "granularity_minutes": 60},
    "PL": {"source": "pse", "currency": "PLN", "granularity_minutes": 15},
}
Pasos de ejecución
Crear el workspace en Fabric y asignarle la capacidad Trial.
Crear un Lakehouse (ej. day_ahead_prices) para almacenar las tablas Delta.
Crear un Notebook y vincularlo al Lakehouse como contexto por defecto.
Pegar el código de los módulos en el orden: modelo de datos → conversor de divisa → conectores → factory → orquestador.
Ejecución manual (single day):
python
   converter = NbpCurrencyConverter()
   orchestrator = IngestionOrchestrator(spark=spark, currency_converter=converter, entsoe_token=ENTSOE_TOKEN)
   target_date = datetime.strptime(run_date_str, "%Y-%m-%d")

   for country_code, config in COUNTRY_CONFIG.items():
       orchestrator.run_for_country(country_code, config, target_date)
Backfill histórico (rango de días):
python
   orchestrator.run_backfill(country_code, config, start_date, end_date)
Automatización: crear un Data Pipeline con una actividad Notebook apuntando a este notebook, parámetro run_date_str con la expresión dinámica @formatDateTime(addDays(utcNow(), 1), 'yyyy-MM-dd'), y programar un trigger diario después de la ventana de publicación de precios (recomendado: 14:00–16:00 CET).
Verificación
python
spark.sql("SELECT COUNT(*) FROM es_day_ahead").show()
spark.sql("SELECT MIN(datetime_utc), MAX(datetime_utc) FROM es_day_ahead").show()
Fase 2 — API REST

Requisitos previos: Python 3.12+, los 4 CSVs exportados desde el notebook de Fabric (ver celdas de exportación al final de notebooks/ingest_day_ahead.ipynb).

Exportar los datos desde Fabric: ejecutar las celdas de exportación del notebook (generan CSVs en Files/exports/ del Lakehouse), descargarlos, y colocarlos en api/data/ con los nombres es_day_ahead.csv, ro_day_ahead.csv, de_day_ahead.csv, pl_day_ahead.csv.
Configurar el entorno virtual:
bash
   cd api
   python -m venv venv
   venv\Scripts\activate          # Windows
   # source venv/bin/activate     # macOS/Linux
   pip install fastapi uvicorn pandas python-dotenv
Crear api/.env:
   API_KEY=<elige-una-clave-secreta>
Ejecutar la API:
bash
   uvicorn main:app --reload

Disponible en http://127.0.0.1:8000, con documentación interactiva en http://127.0.0.1:8000/docs.

Fase 2 — Frontend

Requisitos previos: Node.js 20.19+ o 22.12+.

Instalar dependencias:
bash
   cd frontend
   npm install
Crear frontend/.env:
   VITE_API_BASE_URL=http://127.0.0.1:8000
   VITE_API_KEY=<la-misma-clave-que-en-api/.env>
Ejecutar en modo desarrollo:
bash
   npm run dev

Disponible en http://localhost:5173. Requiere que la API (paso anterior) esté corriendo simultáneamente en otra terminal.

Despliegue en producción

Aunque el enunciado permite que la solución funcione únicamente en local, se optó por desplegarla públicamente para facilitar la revisión:

Interfaz web: https://data-prueba-tecnica.vercel.app — desplegada en Vercel (plan gratuito Hobby)
API REST: https://day-ahead-api.onrender.com — desplegada en Render (plan gratuito Free)

Nota sobre el plan gratuito de Render: el servicio "duerme" tras un periodo de inactividad. La primera petición tras un periodo sin uso puede tardar 30-60 segundos en responder mientras el contenedor se reactiva; las siguientes son inmediatas. Esto es una limitación conocida y aceptada del plan gratuito, no un error de la aplicación.

CORS: la API solo acepta peticiones desde localhost:5173 (desarrollo) y el dominio de producción de Vercel, restringido explícitamente en main.py en vez de usar un wildcard abierto.

Estructura del repositorio
├── README.md                          # este documento
├── notebooks/
│   └── ingest_day_ahead.ipynb         # notebook de ingesta (Fase 1)
├── api/                                # API REST (Fase 2)
│   ├── main.py                         # endpoints FastAPI
│   ├── security.py                     # validación de API Key
│   ├── data_repository.py              # lectura/caché de los CSVs
│   ├── data/                           # CSVs exportados desde Fabric (no versionados si son pesados)
│   └── .env                            # API_KEY (no versionado)
└── frontend/                           # interfaz web (Fase 2)
    ├── src/
    │   ├── api/client.js                # cliente HTTP hacia la API
    │   ├── components/
    │   │   ├── ControlPanel.jsx
    │   │   ├── PriceChart.jsx
    │   │   └── ComparisonChart.jsx
    │   ├── App.jsx
    │   └── index.css
    └── .env                             # VITE_API_BASE_URL, VITE_API_KEY (no versionado)
Limitaciones conocidas
No se cubre el caso de caída total de una fuente durante una ventana prolongada (más allá de reintentos básicos); en producción se recomendaría añadir reintentos con backoff exponencial y alertas.
El token de ENTSO-E se gestiona vía variable de entorno (os.environ.get) en el notebook; en producción debería vivir en Azure Key Vault.
Los huecos de datos detectados en la fuente ENTSO-E para franjas horarias puntuales no se interpolan (ver Decisiones técnicas). En la gráfica comparativa, un hueco solo se muestra como discontinuidad visible cuando una hora completa carece de datos; si faltan solo algunas de las muestras de 15 minutos dentro de una hora (como ocurre en el caso documentado del 26-ago-2026), el promedio horario se calcula igualmente con las muestras disponibles, sin marcador visual de que la muestra fue parcial. La gráfica de detalle por país (datos en granularidad nativa) tampoco marca estos huecos, al no incluir marcadores null explícitos para los timestamps ausentes.
La API REST no tiene conexión en vivo a Fabric; depende de una exportación manual periódica a CSV (ver Decisión técnica #7), motivada por restricciones de Conditional Access del tenant de Fabric utilizado.
La API Key del frontend queda expuesta en el bundle de JavaScript servido al navegador (limitación inherente a cualquier VITE_* env var); aceptable para una demo local, no para producción.
