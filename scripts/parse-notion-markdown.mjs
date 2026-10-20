import fs from "node:fs";

function parseAmount(value) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Number(normalized);
}

function parseFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const rows = [];
  let project = null;

  for (const line of lines) {
    const projectMatch = line.match(/^1\.\s+(.+?)\s*$/);
    if (projectMatch) {
      project = projectMatch[1].trim();
      continue;
    }

    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (!/^\d{1,3}(?:\.\d{3})*,\d{2}€$/.test(cells[0] ?? "")) continue;
    const dateIndex = cells.findIndex((cell) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cell));
    if (dateIndex < 0) continue;

    const [day, month, year] = cells[dateIndex].split("/").map(Number);
    rows.push({
      project,
      amount: parseAmount(cells[0]),
      concept: cells[1] || "Sin concepto",
      account: cells[2] || null,
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }

  return rows;
}

const files = process.argv.slice(2);
const output = files.map((file) => {
  const rows = parseFile(file);
  const negodigi = rows.filter((row) => row.project === "NegoDigi");
  return {
    file,
    totalRows: rows.length,
    negodigiRows: negodigi.length,
    negodigiTotal: Number(negodigi.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
    rows: negodigi,
  };
});

process.stdout.write(JSON.stringify(output, null, 2));
