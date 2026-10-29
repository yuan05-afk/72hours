// Countries offered in the scoping check: every country a rule in the rulebook names (EU/EEA, UK, Philippines,
// Singapore, US) plus common others, so people can record where everyone affected lives even when no rule applies.
const CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'PH', 'SG', 'US', 'CA', 'AU', 'NZ', 'IN',
  'JP', 'KR', 'CN', 'HK', 'TW', 'MY', 'ID', 'TH', 'VN', 'AE', 'SA', 'IL', 'TR', 'CH', 'BR', 'MX', 'AR', 'CL', 'CO',
  'ZA', 'NG', 'KE', 'EG',
];

const names = new Intl.DisplayNames(['en'], { type: 'region' });

export const countryName = (code) => {
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
};

export const COUNTRIES = CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
