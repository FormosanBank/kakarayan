export function wordError(reference: string, hypothesis: string) {
  const words = (value: string) =>
    value.normalize("NFC").trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const expected = words(reference);
  const actual = words(hypothesis);
  let previous = actual.map((_, index) => index + 1);
  previous.unshift(0);
  for (let row = 1; row <= expected.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= actual.length; column += 1) {
      current.push(
        Math.min(
          (current[column - 1] ?? 0) + 1,
          (previous[column] ?? 0) + 1,
          (previous[column - 1] ?? 0) +
            (expected[row - 1] === actual[column - 1] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  const edits = previous[actual.length] ?? expected.length;
  return {
    edits,
    referenceWords: expected.length,
    hypothesisWords: actual.length,
    rate: expected.length ? edits / expected.length : 0,
  };
}
