// Recreates the shape of .NET's DataSet.GetXml() for a single table named
// `rowTag` inside a dataset - the exact input format the legacy
// BZ_Scheme_Calculation_* stored procs parse with OPENXML. Needed because we
// don't own those procs; we just have to hand them what they already expect.
function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildDataSetXml(rowTag: string, rows: Array<Record<string, unknown>>, root = 'DocumentElement'): string {
  const rowXml = rows
    .map((row) => {
      const fields = Object.entries(row)
        .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
        .join('');
      return `<${rowTag}>${fields}</${rowTag}>`;
    })
    .join('');
  return `<${root}>${rowXml}</${root}>`;
}
