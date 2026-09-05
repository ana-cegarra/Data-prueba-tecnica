const ALL_COUNTRIES = ["ES", "RO", "DE", "PL"];

const COUNTRY_COLORS = {
  ES: "var(--country-es)",
  RO: "var(--country-ro)",
  DE: "var(--country-de)",
  PL: "var(--country-pl)",
};

export default function ControlPanel({
  selectedCountries,
  onToggleCountry,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}) {
  return (
    <aside
      style={{
        width: "260px",
        padding: "1.5rem",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border-subtle)",
        height: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h2 style={{ fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
        Países
      </h2>

      {ALL_COUNTRIES.map((country) => {
        const isSelected = selectedCountries.includes(country);
        return (
          <label
            key={country}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              padding: "0.5rem 0",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleCountry(country)}
              style={{ accentColor: COUNTRY_COLORS[country] }}
            />
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "2px",
                background: COUNTRY_COLORS[country],
                display: "inline-block",
              }}
            />
            {country}
          </label>
        );
      })}

      <h2 style={{ fontSize: "0.95rem", color: "var(--text-secondary)", margin: "1.5rem 0 1rem" }}>
        Rango de fechas
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
          <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>
    </aside>
  );
}

const inputStyle = {
  width: "100%",
  marginTop: "0.25rem",
  padding: "0.4rem",
  background: "var(--bg-base)",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-primary)",
  borderRadius: "4px",
  fontFamily: "var(--font-mono)",
};

export { ALL_COUNTRIES, COUNTRY_COLORS };