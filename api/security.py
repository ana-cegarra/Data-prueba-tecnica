import os
from fastapi import Header, HTTPException, status

def verify_api_key(x_api_key: str = Header(...)):
    """
    Dependencia de FastAPI que se inyecta en cada endpoint protegido. Compara el header 'X-API-Key' del request 
    contra el valor esperado (definido en .env). Si no coincide, corta la petición con 401 antes de que llegue a la 
    lógica del endpoint.
    """
    expected_key = os.getenv("API_KEY")
    if x_api_key != expected_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key inválida o faltante"
        )