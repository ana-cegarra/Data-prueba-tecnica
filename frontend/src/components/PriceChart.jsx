import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { COUNTRY_COLORS } from "./ControlPanel";

export default function PriceChart({ country, data }) {
  if (!data || data.length === 0) {
    return <EmptyState message={`Sin datos para ${country} en el rango seleccionado.`} />;
  }

  // Formateamos la fecha para el eje X: solo hora:minuto si es un rango corto,
  // o fecha completa si el rango es de varios días (evita etiquetas ilegibles)
  const chartData = data.map((d) => ({
    ...d,
    label: formatLabel(d.datetime_utc),
  }));

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{country}</h3>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
          {data[0].granularity_minutes}min · {data.length} puntos
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis
            dataKey="label"
            stroke="var(--text-secondary)"
            fontSize={11}
            minTickGap={40}
          />
          <YAxis
            stroke="var(--text-secondary)"
            fontSize={11}
            label={{ value: "€/MWh", angle: -90, position: "insideLeft", fill: "var(--text-secondary)", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
            labelStyle={{ color: "var(--text-primary)" }}
          />
          <Line
            type="monotone"
            dataKey="price_eur"
            stroke={COUNTRY_COLORS[country]}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatLabel(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EmptyState({ message }) {
  return (
    <div style={{ ...cardStyle, color: "var(--text-secondary)", textAlign: "center", padding: "2rem" }}>
      {message}
    </div>
  );
}

const cardStyle = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "6px",
  padding: "1rem",
  marginBottom: "1rem",
};