import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { COUNTRY_COLORS } from "./ControlPanel";

export default function ComparisonChart({ dataByCountry }) {
  const countries = Object.keys(dataByCountry).filter(
    (c) => Array.isArray(dataByCountry[c]) && dataByCountry[c].length > 0
  );

  if (countries.length === 0) {
    return <EmptyState message="Selecciona al menos un país con datos disponibles." />;
  }

  const merged = mergeToHourlyBuckets(dataByCountry, countries);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-mono)" }}>Comparativa</h3>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
          Promedio horario · normaliza PT15M y PT60M a la misma resolución
        </span>
      </div>

      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={merged} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey="label" stroke="var(--text-secondary)" fontSize={11} minTickGap={40} />
          <YAxis
            stroke="var(--text-secondary)"
            fontSize={11}
            label={{ value: "€/MWh", angle: -90, position: "insideLeft", fill: "var(--text-secondary)", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
            labelStyle={{ color: "var(--text-primary)" }}
          />
          <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }} />
          {countries.map((country) => (
            <Line
              key={country}
              type="monotone"
              dataKey={country}
              stroke={COUNTRY_COLORS[country]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Agrupa los registros de cada país por HORA (truncando los minutos),
 * promediando los valores que caigan en la misma hora. Esto homogeneiza
 * PT15M (4 valores/hora) y PT60M (1 valor/hora) a un único punto por hora,
 * permitiendo superponerlos en el mismo eje X sin inventar datos donde
 * la fuente original no los tenía.
 */
function mergeToHourlyBuckets(dataByCountry, countries) {
  const buckets = {}; // { "2026-09-01T00": { ES: [v1, v2, v3, v4], DE: [v1] } }

  countries.forEach((country) => {
    dataByCountry[country].forEach((record) => {
      const hourKey = record.datetime_utc.slice(0, 13); // "YYYY-MM-DDTHH"
      if (!buckets[hourKey]) buckets[hourKey] = {};
      if (!buckets[hourKey][country]) buckets[hourKey][country] = [];
      buckets[hourKey][country].push(record.price_eur);
    });
  });

  return Object.keys(buckets)
    .sort()
    .map((hourKey) => {
      const row = { label: formatHourLabel(hourKey) };
      countries.forEach((country) => {
        const values = buckets[hourKey][country];
        row[country] = values ? average(values) : null; // null deja un hueco visible en la línea, no lo inventa
      });
      return row;
    });
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function formatHourLabel(hourKey) {
  const d = new Date(hourKey + ":00:00Z");
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EmptyState({ message }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "6px", padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
      {message}
    </div>
  );
}

const cardStyle = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "6px",
  padding: "1rem",
};