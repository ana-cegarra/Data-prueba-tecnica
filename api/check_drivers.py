import pyodbc
print("Drivers ODBC instalados:")
for driver in pyodbc.drivers():
    print(f"  - {driver}")