import os
import struct
import pyodbc
from azure.identity import DeviceCodeCredential
from dotenv import load_dotenv

load_dotenv()

SERVER = os.getenv("FABRIC_SQL_SERVER")
DATABASE = os.getenv("FABRIC_SQL_DATABASE")

SQL_SCOPE = "https://database.windows.net/.default"

print("Solicitando token de acceso...")
credential = DeviceCodeCredential()
token = credential.get_token(SQL_SCOPE)

token_bytes = token.token.encode("utf-16-le")
token_struct = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
SQL_COPT_SS_ACCESS_TOKEN = 1256  # constante definida por el driver ODBC de SQL Server

connection_string = (
    f"Driver={{ODBC Driver 18 for SQL Server}};"
    f"Server={SERVER},1433;"
    f"Database={DATABASE};"
    f"Encrypt=yes;"
    f"TrustServerCertificate=no;"
)

print("Conectando a Fabric con el token obtenido...")
conn = pyodbc.connect(
    connection_string,
    attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct}
)
cursor = conn.cursor()

cursor.execute("SELECT TOP 5 * FROM es_day_ahead ORDER BY datetime_utc")
rows = cursor.fetchall()

print(f"\n✅ Conexión exitosa. Primeras filas de es_day_ahead:")
for row in rows:
    print(row)

conn.close()