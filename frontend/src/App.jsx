import { useEffect, useState, useCallback } from "react";
import ControlPanel, { ALL_COUNTRIES } from "./components/ControlPanel";
import PriceChart from "./components/PriceChart";
import ComparisonChart from "./components/ComparisonChart";
import { comparePrices } from "./api/client";
import "./index.css";

// Rango por defecto: últimos días de los que ya sabemos que hay datos ingeridos
const DEFAULT_DATE_FROM = "2026-08-25";
const DEFAULT_DATE_TO = "2026-09-05";

function App() {
  const [selectedCountries, setSelectedCountries] = useState(ALL_COUNTRIES);
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO);
  const [dataByCountry, setDataByCountry] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(() => {
    if (selectedCountries.length === 0) {
      setDataByCountry({});
      return;
    }
    setLoading(true);
    setError(null);

    comparePrices(selectedCountries, dateFrom, dateTo)
      .then((result) => {
        // el endpoint /compare devuelve {error: "..."} para países sin datos;
        // los filtramos para no romper las gráficas
        const clean = {};
        Object.entries(result).forEach(([country, value]) => {
          clean[country] = Array.isArray(value) ? value : [];
        });
        setDataByCountry(clean);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedCountries, dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleCountry = (country) => {
    setSelectedCountries((prev) =>
      prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country]
    );
  };

  return (
    <div style={{ display: "flex" }}>
      <ControlPanel
        selectedCountries={selectedCountries}
        onToggleCountry={toggleCountry}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
      />

      <main style={{ flex: 1, padding: "1.5rem", maxWidth: "1100px" }}>
        <h1 style={{ fontSize: "1.4rem", marginTop: 0 }}>Precios Day-Ahead</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "-0.5rem", fontSize: "0.9rem" }}>
          España · Rumanía · Alemania · Polonia — precios convertidos a EUR/MWh
        </p>

        {loading && <p style={{ color: "var(--text-secondary)" }}>Cargando...</p>}
        {error && <p style={{ color: "var(--country-de)" }}>Error: {error}</p>}

        {!loading && !error && (
          <>
            <ComparisonChart dataByCountry={dataByCountry} />

            <h2 style={{ fontSize: "1rem", color: "var(--text-secondary)", marginTop: "1.5rem" }}>
              Detalle por país
            </h2>
            {selectedCountries.map((country) => (
              <PriceChart key={country} country={country} data={dataByCountry[country]} />
            ))}
          </>
        )}
      </main>
    </div>
  );
}

export default App;