from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from dotenv import load_dotenv

from security import verify_api_key
from data_repository import repository

load_dotenv()

app = FastAPI(
    title="Grenergy Day-Ahead Prices API",
    description="API REST para consultar precios Day-Ahead de electricidad de ES, RO, DE, PL",
    version="1.0.0",
)

# CORS: permite que el frontend React pueda hacer peticiones a esta API sin ser bloqueado por el navegador
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",           # para seguir desarrollando en local
        "https://data-prueba-tecnica.vercel.app",  # tu frontend en producción
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    """Endpoint sin autenticación, útil para verificar que la API está viva."""
    return {"status": "ok"}


@app.get("/countries", dependencies=[Depends(verify_api_key)])
def get_countries():
    """Devuelve la lista de países disponibles."""
    return {"countries": repository.get_available_countries()}


@app.get("/prices", dependencies=[Depends(verify_api_key)])
def get_prices(
    country: str = Query(..., description="Código de país: ES, RO, DE, PL"),
    date_from: Optional[str] = Query(None, description="Fecha inicio, formato YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="Fecha fin, formato YYYY-MM-DD"),
):
    try:
        df = repository.get_filtered(country, date_from, date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # .assign() crea una nueva columna sin mutar el DataFrame original en memoria
    df = df.assign(datetime_utc=df["datetime_utc"].dt.strftime("%Y-%m-%dT%H:%M:%S"))
    return df.to_dict(orient="records")

@app.get("/prices/compare", dependencies=[Depends(verify_api_key)])
def compare_prices(
    countries: str = Query(..., description="Códigos separados por coma, ej: ES,DE,PL"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    country_list = [c.strip().upper() for c in countries.split(",")]
    result = {}

    for country in country_list:
        try:
            df = repository.get_filtered(country, date_from, date_to)
            df = df.assign(datetime_utc=df["datetime_utc"].dt.strftime("%Y-%m-%dT%H:%M:%S"))
            result[country] = df.to_dict(orient="records")
        except (ValueError, FileNotFoundError) as e:
            result[country] = {"error": str(e)}

    return result