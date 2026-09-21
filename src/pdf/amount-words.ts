const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(value: number): string {
  const parts: string[] = [];
  if (value >= 100) {
    parts.push(`${ONES[Math.floor(value / 100)]} Hundred`);
    value %= 100;
  }
  if (value >= 20) {
    parts.push(TENS[Math.floor(value / 10)] + (value % 10 ? ` ${ONES[value % 10]}` : ''));
  } else if (value > 0) {
    parts.push(ONES[value]);
  }
  return parts.join(' ');
}

function wholeToWords(value: number, format: 'indian' | 'international'): string {
  if (value === 0) return 'Zero';
  // Indian grouping counts in thousands then lakhs and crores; international in thousands, millions, billions.
  const units: Array<[number, string]> = format === 'indian'
    ? [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1_000, 'Thousand']]
    : [[1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1_000, 'Thousand']];
  const parts: string[] = [];
  let rest = value;
  for (const [size, name] of units) {
    if (rest >= size) {
      const count = Math.floor(rest / size);
      parts.push(`${count >= 1000 && format === 'indian' && size === 10_000_000 ? wholeToWords(count, format) : belowThousand(count)} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only" */
export function amountToWords(amount: number, format: 'indian' | 'international' = 'indian'): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);
  const [wholeRupees, carriedPaise] = paise === 100 ? [rupees + 1, 0] : [rupees, paise];
  const rupeeWords = `Rupees ${wholeToWords(wholeRupees, format)}`;
  const paiseWords = carriedPaise > 0 ? ` and ${belowThousand(carriedPaise)} Paise` : '';
  return `${amount < 0 ? 'Minus ' : ''}${rupeeWords}${paiseWords} Only`;
}
