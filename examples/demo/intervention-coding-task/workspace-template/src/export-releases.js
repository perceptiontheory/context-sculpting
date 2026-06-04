export function exportReleasesCsv(store, options = {}) {
  const draftOnly = options.draftOnly === true;
  const releases = store.releases
    .filter((release) => (draftOnly ? release.status !== "shipped" : true))
    .slice()
    .sort((left, right) => left.owner.localeCompare(right.owner));

  const lines = ["id,name,state,owner"];
  for (const release of releases) {
    lines.push(
      [
        escapeCsvCell(String(release.id)),
        escapeCsvCell(release.name),
        escapeCsvCell(release.status),
        escapeCsvCell(release.owner)
      ].join(",")
    );
  }

  return lines.join("\n");
}

function escapeCsvCell(value) {
  if (/[,"\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}
