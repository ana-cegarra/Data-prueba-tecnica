import pandas as pd
from pathlib import Path
from functools import lru_cache

DATA_DIR = Path(__file__).parent / "data"  # ruta relativa a este archivo, no depende de dónde ejecutes el comando
VALID_COUNTRIES = {"ES", "RO", "DE", "PL"}


class PriceDataRepository:
    """
    Responsable ÚNICO de leer y poner en cache los CSVs exportados desde Fabric por el mismo principio
    de Dependency Inversion que usamos en el pipeline de ingesta.
    """
    @lru_cache(maxsize=None)
    def get_country_data(self, country: str) -> pd.DataFrame:
        country = country.upper()
        if country not in VALID_COUNTRIES:
            raise ValueError(f"País no soportado: {country}")

        csv_path = DATA_DIR / f"{country.lower()}_day_ahead.csv"
        if not csv_path.exists():
            raise FileNotFoundError(f"No se encontró el archivo de datos para {country}")

        df = pd.read_csv(csv_path, parse_dates=["datetime_utc"])
        
        # Normalizamos a timestamps "naive" (sin tz-info explícita) inmediatamente
        # al cargar. Como TODOS nuestros datos ya están en UTC por diseño del
        # pipeline de ingesta, no perdemos información — solo evitamos el conflicto
        # de tipos al comparar con fechas de filtro que llegan sin tz-info.
        if df["datetime_utc"].dt.tz is not None:
            df["datetime_utc"] = df["datetime_utc"].dt.tz_localize(None)
        
        return df.sort_values("datetime_utc").reset_index(drop=True)

    def get_filtered(self, country: str, date_from: str = None, date_to: str = None) -> pd.DataFrame:   
        df = self.get_country_data(country).copy()  # <-- .copy() evita mutar el objeto cacheado

        if date_from:
            df = df[df["datetime_utc"] >= pd.to_datetime(date_from)]
        if date_to:
            df = df[df["datetime_utc"] <= pd.to_datetime(date_to)]

        return df

    def get_available_countries(self) -> list:
        return sorted(VALID_COUNTRIES)


# instancia única compartida por toda la app (patrón singleton simple)
repository = PriceDataRepository()