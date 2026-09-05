import axios from "axios";

// Vite solo expone al navegador las variables de entorno prefijadas con VITE_
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const API_KEY = import.meta.env.VITE_API_KEY;

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: { "X-API-Key": API_KEY },
});

export async function getCountries() {
  const { data } = await client.get("/countries");
  return data.countries;
}

export async function getPrices(country, dateFrom, dateTo) {
  const { data } = await client.get("/prices", {
    params: { country, date_from: dateFrom, date_to: dateTo },
  });
  return data;
}

export async function comparePrices(countries, dateFrom, dateTo) {
  const { data } = await client.get("/prices/compare", {
    params: { countries: countries.join(","), date_from: dateFrom, date_to: dateTo },
  });
  return data;
}