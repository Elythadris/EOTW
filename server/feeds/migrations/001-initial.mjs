// The initial document-store migration is lazy and idempotent, including on a new Netlify site.
export const initialSnapshot = () => ({version:1,events:[],days:[],providers:{},updatedAt:null});
export function openSnapshot(value) {
  if (value == null) return initialSnapshot();
  if (value.version !== 1) throw new Error("Unsupported reporting schema");
  return value;
}
