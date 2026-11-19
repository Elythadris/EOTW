// Cartographic label points, rounded to 0.1 degrees. Coordinates are longitude, latitude.
// Countries: Natural Earth, public domain, 1:110m, revision ca96624a56bd078437bca8184e78163e5039ad19.
// States and Maui County: U.S. Census TIGERweb State_County (INTPTLON, INTPTLAT).
const countries = [
  ["Afghanistan", "AF", 66.5, 34.2],
  ["Albania", "AL", 20.1, 40.7],
  ["Algeria", "DZ", 2.8, 27.4],
  ["Angola", "AO", 18, -12.2],
  ["Antarctica", "AQ", 35.9, -79.8],
  ["Argentina", "AR", -64.2, -33.5],
  ["Armenia", "AM", 44.8, 40.5],
  ["Australia", "AU", 134, -24.1],
  ["Austria", "AT", 14.1, 47.5],
  ["Azerbaijan", "AZ", 47.2, 40.4],
  ["Bangladesh", "BD", 89.7, 24.2],
  ["Belarus", "BY", 28.4, 53.8],
  ["Belgium", "BE", 4.8, 50.8],
  ["Belize", "BZ", -88.7, 17.2],
  ["Benin", "BJ", 2.4, 10.3],
  ["Bhutan", "BT", 90, 27.5],
  ["Bolivia", "BO", -64.6, -16.7],
  ["Bosnia and Herzegovina", "BA", 18.1, 44.1],
  ["Botswana", "BW", 24.2, -22.1],
  ["Brazil", "BR", -49.6, -12.1],
  ["Brunei", "BN", 114.6, 4.4],
  ["Bulgaria", "BG", 25.2, 42.5],
  ["Burkina Faso", "BF", -1.4, 12.7],
  ["Burundi", "BI", 29.9, -3.3],
  ["Cambodia", "KH", 104.5, 12.6],
  ["Cameroon", "CM", 12.5, 4.6],
  ["Canada", "CA", -101.9, 60.3],
  ["Central African Republic", "CF", 20.9, 7],
  ["Chad", "TD", 18.6, 15.1],
  ["Chile", "CL", -72.3, -38.2],
  ["Colombia", "CO", -73.2, 3.4],
  ["Costa Rica", "CR", -84.1, 10.1],
  ["Croatia", "HR", 16.4, 45.8],
  ["Cuba", "CU", -78, 21.3],
  ["Cyprus", "CY", 33.1, 34.9],
  ["Czech Republic", "CZ", 15.4, 49.9],
  ["Democratic Republic of the Congo", "CD", 23.5, -1.9],
  ["Denmark", "DK", 9, 56],
  ["Djibouti", "DJ", 42.5, 12],
  ["Dominican Republic", "DO", -70.7, 19.1],
  ["East Timor", "TL", 125.9, -8.8],
  ["Ecuador", "EC", -78.2, -1.3],
  ["Egypt", "EG", 29.4, 26.2],
  ["El Salvador", "SV", -88.9, 13.7],
  ["Equatorial Guinea", "GQ", 9, 2.3],
  ["Eritrea", "ER", 38.3, 15.8],
  ["Estonia", "EE", 25.9, 58.7],
  ["Eswatini", "SZ", 31.5, -26.5],
  ["Ethiopia", "ET", 39.1, 8],
  ["Falkland Islands", "FK", -58.7, -51.6],
  ["Fiji", "FJ", 178, -17.8],
  ["Finland", "FI", 27.3, 63.3],
  ["France", "FR", 2.6, 46.7],
  ["French Southern and Antarctic Lands", "TF", 69.1, -49.3],
  ["Gabon", "GA", 11.8, -0.4],
  ["Georgia", "GE", 43.7, 41.9],
  ["Germany", "DE", 9.7, 51],
  ["Ghana", "GH", -1, 7.7],
  ["Greece", "GR", 21.7, 39.5],
  ["Greenland", "GL", -39.3, 74.3],
  ["Guatemala", "GT", -90.5, 15],
  ["Guinea", "GN", -10, 10.6],
  ["Guinea-Bissau", "GW", -14.5, 12.2],
  ["Guyana", "GY", -58.9, 5.1],
  ["Haiti", "HT", -72.2, 19.3],
  ["Honduras", "HN", -86.9, 14.8],
  ["Hungary", "HU", 19.4, 47.1],
  ["Iceland", "IS", -18.7, 64.8],
  ["India", "IN", 79.4, 22.7],
  ["Indonesia", "ID", 101.9, -1],
  ["Iran", "IR", 54.9, 32.2],
  ["Iraq", "IQ", 43.3, 33.1],
  ["Ireland", "IE", -7.8, 53.1],
  ["Israel", "IL", 34.8, 30.9],
  ["Italy", "IT", 11.1, 44.7],
  ["Ivory Coast", "CI", -5.6, 7.5],
  ["Jamaica", "JM", -77.3, 18.1],
  ["Japan", "JP", 138.4, 36.1],
  ["Jordan", "JO", 36.4, 30.8],
  ["Kazakhstan", "KZ", 68.7, 49.1],
  ["Kenya", "KE", 37.9, 0.5],
  ["Kosovo", "XK", 20.9, 42.6],
  ["Kuwait", "KW", 47.3, 29.4],
  ["Kyrgyzstan", "KG", 74.5, 41.7],
  ["Laos", "LA", 102.5, 19.4],
  ["Latvia", "LV", 25.5, 57.1],
  ["Lebanon", "LB", 36, 34.1],
  ["Lesotho", "LS", 28.2, -29.5],
  ["Liberia", "LR", -9.5, 6.4],
  ["Libya", "LY", 18, 26.6],
  ["Lithuania", "LT", 24.1, 55.1],
  ["Luxembourg", "LU", 6.1, 49.7],
  ["Madagascar", "MG", 46.7, -18.6],
  ["Malawi", "MW", 33.6, -13.4],
  ["Malaysia", "MY", 113.8, 2.5],
  ["Mali", "ML", -2, 18.7],
  ["Mauritania", "MR", -9.7, 19.6],
  ["Mexico", "MX", -102.3, 23.9],
  ["Moldova", "MD", 28.5, 47.4],
  ["Mongolia", "MN", 104.2, 46],
  ["Montenegro", "ME", 19.1, 42.8],
  ["Morocco", "MA", -7.2, 31.7],
  ["Mozambique", "MZ", 37.8, -13.9],
  ["Myanmar", "MM", 95.8, 21.6],
  ["Namibia", "NA", 17.1, -20.6],
  ["Nepal", "NP", 83.6, 28.3],
  ["Netherlands", "NL", 5.6, 52.4],
  ["New Caledonia", "NC", 165.1, -21.1],
  ["New Zealand", "NZ", 172.8, -39.8],
  ["Nicaragua", "NI", -85.1, 12.7],
  ["Niger", "NE", 9.5, 17.4],
  ["Nigeria", "NG", 7.5, 9.4],
  ["North Korea", "KP", 126.4, 39.9],
  ["North Macedonia", "MK", 21.6, 41.6],
  ["Norway", "NO", 9.7, 61.4],
  ["Oman", "OM", 57.3, 22.1],
  ["Pakistan", "PK", 68.5, 29.3],
  ["Palestine", "PS", 35.3, 32],
  ["Panama", "PA", -80.4, 8.7],
  ["Papua New Guinea", "PG", 143.9, -5.7],
  ["Paraguay", "PY", -60.1, -21.7],
  ["People's Republic of China", "CN", 106.3, 32.5],
  ["Peru", "PE", -72.9, -13],
  ["Philippines", "PH", 122.5, 11.2],
  ["Poland", "PL", 19.5, 52],
  ["Portugal", "PT", -8.3, 39.6],
  ["Puerto Rico", "PR", -66.5, 18.2],
  ["Qatar", "QA", 51.1, 25.2],
  ["Republic of the Congo", "CG", 15.9, 0.1],
  ["Romania", "RO", 25, 45.7],
  ["Russia", "RU", 44.7, 58.2],
  ["Rwanda", "RW", 30.1, -1.9],
  ["Saudi Arabia", "SA", 44.7, 23.8],
  ["Senegal", "SN", -14.8, 15.1],
  ["Serbia", "RS", 20.8, 44.2],
  ["Sierra Leone", "SL", -11.8, 8.6],
  ["Slovakia", "SK", 19, 48.7],
  ["Slovenia", "SI", 14.9, 46.1],
  ["Solomon Islands", "SB", 159.2, -8],
  ["Somalia", "SO", 45.2, 3.6],
  ["South Africa", "ZA", 23.7, -29.7],
  ["South Korea", "KR", 128.1, 36.4],
  ["South Sudan", "SS", 30.4, 7.2],
  ["Spain", "ES", -3.5, 40.1],
  ["Sri Lanka", "LK", 80.7, 7.6],
  ["Sudan", "SD", 29.3, 16.3],
  ["Suriname", "SR", -55.9, 4.1],
  ["Sweden", "SE", 19, 65.9],
  ["Switzerland", "CH", 7.5, 46.7],
  ["Syria", "SY", 38.3, 35],
  ["Taiwan", "TW", 120.9, 23.7],
  ["Tajikistan", "TJ", 72.6, 38.2],
  ["Tanzania", "TZ", 35, -6.1],
  ["Thailand", "TH", 101.1, 15.5],
  ["The Bahamas", "BS", -77.1, 26.4],
  ["The Gambia", "GM", -15, 13.6],
  ["Togo", "TG", 1.1, 8.8],
  ["Trinidad and Tobago", "TT", -60.9, 11],
  ["Tunisia", "TN", 9, 33.7],
  ["Turkey", "TR", 34.5, 39.3],
  ["Turkmenistan", "TM", 58.7, 39.9],
  ["Uganda", "UG", 32.9, 2],
  ["Ukraine", "UA", 32.1, 49.7],
  ["United Arab Emirates", "AE", 54.5, 23.5],
  ["United Kingdom", "GB", -2.1, 54.4],
  ["United States of America", "US", -97.5, 39.5],
  ["Uruguay", "UY", -56, -33],
  ["Uzbekistan", "UZ", 64, 41.7],
  ["Vanuatu", "VU", 166.9, -15.4],
  ["Venezuela", "VE", -64.6, 7.2],
  ["Vietnam", "VN", 105.4, 21.7],
  ["Western Sahara", "EH", -12.6, 24],
  ["Yemen", "YE", 45.9, 15.3],
  ["Zambia", "ZM", 26.4, -14.7],
  ["Zimbabwe", "ZW", 29.9, -18.9],
];
const regions = [
  ["Alabama", "AL", -86.8, 32.7],
  ["Alaska", "AK", -152.8, 63.3],
  ["American Samoa", "AS", -170.7, -14.3],
  ["Arizona", "AZ", -111.6, 34.2],
  ["Arkansas", "AR", -92.4, 34.9],
  ["California", "CA", -119.6, 37.2],
  ["Colorado", "CO", -105.5, 39],
  ["Commonwealth of the Northern Mariana Islands", "MP", 145.6, 15],
  ["Connecticut", "CT", -72.7, 41.6],
  ["Delaware", "DE", -75.4, 39],
  ["District of Columbia", "DC", -77, 38.9],
  ["Florida", "FL", -82.5, 28.4],
  ["Georgia", "GA", -83.4, 32.6],
  ["Guam", "GU", 144.8, 13.4],
  ["Hawaii", "HI", -155.5, 19.8],
  ["Idaho", "ID", -114.6, 44.4],
  ["Illinois", "IL", -89.2, 40.1],
  ["Indiana", "IN", -86.3, 39.9],
  ["Iowa", "IA", -93.5, 42.1],
  ["Kansas", "KS", -98.4, 38.5],
  ["Kentucky", "KY", -85.3, 37.5],
  ["Louisiana", "LA", -91.6, 30.7],
  ["Maine", "ME", -68.7, 45.4],
  ["Maryland", "MD", -76.7, 38.9],
  ["Massachusetts", "MA", -71.5, 42.2],
  ["Michigan", "MI", -85.7, 44.8],
  ["Minnesota", "MN", -94.2, 46.3],
  ["Mississippi", "MS", -89.7, 32.7],
  ["Missouri", "MO", -92.5, 38.4],
  ["Montana", "MT", -109.6, 47.1],
  ["Nebraska", "NE", -99.8, 41.5],
  ["Nevada", "NV", -116.6, 39.3],
  ["New Hampshire", "NH", -71.6, 43.7],
  ["New Jersey", "NJ", -74.7, 40.1],
  ["New Mexico", "NM", -106.1, 34.4],
  ["New York", "NY", -75.6, 42.9],
  ["North Carolina", "NC", -79.1, 35.5],
  ["North Dakota", "ND", -100.5, 47.4],
  ["Ohio", "OH", -82.7, 40.4],
  ["Oklahoma", "OK", -97.5, 35.6],
  ["Oregon", "OR", -120.6, 44],
  ["Pennsylvania", "PA", -77.8, 40.9],
  ["Puerto Rico", "PR", -66.4, 18.2],
  ["Rhode Island", "RI", -71.5, 41.6],
  ["South Carolina", "SC", -80.9, 33.9],
  ["South Dakota", "SD", -100.2, 44.4],
  ["Tennessee", "TN", -86.3, 35.9],
  ["Texas", "TX", -99.3, 31.4],
  ["United States Virgin Islands", "VI", -65, 18.3],
  ["Utah", "UT", -111.7, 39.3],
  ["Vermont", "VT", -72.7, 44.1],
  ["Virginia", "VA", -78.7, 37.5],
  ["Washington", "WA", -120.6, 47.4],
  ["West Virginia", "WV", -80.6, 38.6],
  ["Wisconsin", "WI", -89.7, 44.6],
  ["Wyoming", "WY", -107.5, 43],
];
const byCode = new Map(
  countries.map(([name, code, lon, lat]) => [
    code,
    { name, coords: [lon, lat], precision: "country" },
  ]),
);
const byState = new Map(
  regions.map(([name, code, lon, lat]) => [
    code,
    { name, coords: [lon, lat], precision: "region" },
  ]),
);
const naturalNames = new Map(
  countries.map(([name, code]) => [name.toLowerCase(), code]),
);
for (const [alias, code] of Object.entries({
  "united states": "US",
  us: "US",
  "u.s.": "US",
  "united kingdom": "GB",
  uk: "GB",
  "czech republic": "CZ",
  "south korea": "KR",
  "north korea": "KP",
  "ivory coast": "CI",
  türkiye: "TR",
  "dr congo": "CD",
  palestine: "PS",
})) {
  if (byCode.has(code)) naturalNames.set(alias, code);
}
const ambiguous = new Set([
  "georgia",
  "turkey",
  "chad",
  "jordan",
  "guinea",
  "congo",
  "us",
  "uk",
  "mali",
  "niger",
  "dominica",
  "guyana",
  "jersey",
  "oman",
]);
const headlineNames = [...naturalNames.keys()]
  .filter((name) => name.length >= 4)
  .map((name) => ({
    name,
    code: naturalNames.get(name),
    pattern: new RegExp(
      "\\b" + name.replace(/[.*+?^$()|[\]\\]/g, "\\$&") + "\\b",
      "i",
    ),
  }));
function reportedCountry(tags, title) {
  const coded = (Array.isArray(tags) ? tags : [tags])
    .map(
      (t) => typeof t === "string" && naturalNames.get(t.toLowerCase().trim()),
    )
    .filter(Boolean);
  const distinct = [...new Set(coded)];
  if (distinct.length)
    return distinct.length === 1 ? byCode.get(distinct[0]) : null;
  // Only an explicit locative construction in the headline can produce an untagged marker.
  if (!/\b(in|across|throughout|inside)\b/i.test(title)) return null;
  const found = headlineNames.filter((item) => item.pattern.test(title));
  if (new Set(found.map((e) => e.code)).size !== 1) return null;
  const match = found.find(
    (item) =>
      !ambiguous.has(item.name) &&
      new RegExp(
        "\\b(?:in|across|throughout|inside)\\s+(?:the\\s+)?" +
          item.pattern.source,
        "i",
      ).test(title),
  );
  return match ? byCode.get(match.code) : null;
}
export function broadLocation(raw, title) {
  let place = null,
    basis = "Source coverage area";
  if (raw.county === "15009") {
    place = {
      name: "Maui County, Hawaiʻi",
      coords: [-156.6, 20.9],
      precision: "region",
    };
    basis = "County bulletin jurisdiction";
  } else if (raw.state && byState.has(raw.state)) {
    place = byState.get(raw.state);
    basis = raw.natural ? "Alert region" : "State bulletin jurisdiction";
  } else if (raw.country && byCode.has(raw.country)) {
    place = byCode.get(raw.country);
    basis = "National bulletin jurisdiction";
  } else if (!raw.natural && !raw.transient)
    place = reportedCountry(raw.placeTags, title);
  return place
    ? {
        ...place,
        note:
          basis +
          " · " +
          place.name +
          ". Approximate " +
          (place.precision === "country" ? "country" : "regional") +
          " reference point.",
      }
    : null;
}
