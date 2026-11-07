import type { LL } from './geo';

// Hand-traced geography of the subcontinent (approximate, lon/lat).
// Coastline runs from the Makran coast clockwise round the peninsula to Arakan.

export const COAST: LL[] = [
  [66.0, 25.35], [66.6, 25.42], [66.9, 24.98], [67.05, 24.8], [67.25, 24.55], [67.45, 24.05],
  [67.8, 23.8], [68.2, 23.62], [68.5, 23.5], [68.75, 23.25], [69.1, 22.92], [69.6, 22.8],
  [70.05, 22.92], [70.55, 22.88], [70.3, 22.62], [69.9, 22.5], [69.45, 22.45], [69.05, 22.4],
  [68.97, 22.2], [69.3, 21.85], [69.6, 21.6], [70.05, 21.2], [70.4, 20.9], [71.0, 20.72],
  [71.55, 20.85], [72.05, 21.25], [72.2, 21.7], [72.5, 22.2], [72.65, 22.25], [72.6, 21.75],
  [72.65, 21.3], [72.72, 21.05], [72.85, 20.45], [72.72, 19.85], [72.75, 19.4], [72.78, 19.05],
  [72.85, 18.8], [72.92, 18.4], [73.05, 18.0], [73.15, 17.6], [73.27, 17.05], [73.4, 16.55],
  [73.48, 16.1], [73.65, 15.75], [73.78, 15.4], [74.05, 14.95], [74.15, 14.75], [74.4, 14.3],
  [74.55, 13.9], [74.72, 13.3], [74.82, 12.85], [75.1, 12.3], [75.35, 11.85], [75.75, 11.25],
  [76.0, 10.6], [76.2, 10.0], [76.4, 9.4], [76.55, 8.9], [76.9, 8.5], [77.3, 8.15], [77.55, 8.07],
  [77.9, 8.25], [78.15, 8.75], [78.4, 9.1], [78.95, 9.25], [79.15, 9.3], [79.1, 9.6], [79.15, 9.85],
  [79.35, 10.25], [79.85, 10.3], [79.85, 10.8], [79.8, 11.4], [79.8, 11.95], [80.05, 12.4],
  [80.25, 12.9], [80.3, 13.1], [80.3, 13.55], [80.2, 14.2], [80.15, 14.8], [80.1, 15.3],
  [80.3, 15.7], [80.9, 15.7], [81.15, 16.15], [81.6, 16.3], [82.3, 16.55], [82.35, 16.95],
  [82.85, 17.3], [83.3, 17.65], [83.9, 18.15], [84.45, 18.75], [84.95, 19.25], [85.5, 19.7],
  [85.9, 19.8], [86.4, 20.05], [86.75, 20.35], [86.95, 20.8], [87.05, 21.45], [87.5, 21.62],
  [88.05, 21.7], [88.5, 21.62], [89.1, 21.7], [89.7, 21.85], [90.3, 22.05], [90.65, 22.4],
  [91.1, 22.55], [91.55, 22.6], [91.8, 22.3], [91.95, 21.7], [92.0, 21.3], [92.3, 20.75],
];

const BURMA_COAST: LL[] = [
  [92.7, 20.4], [93.1, 19.9], [93.6, 19.3], [94.1, 18.6], [94.35, 17.6], [94.4, 16.8],
  [94.55, 16.1], [95.2, 15.85], [95.8, 16.0], [96.3, 16.5], [96.9, 16.8], [97.5, 16.7],
];

/** All land on the map, including foreign (unplayable) highlands. */
export const LAND: LL[] = [...COAST, ...BURMA_COAST, [97.5, 36.5], [66.0, 36.5]];

export const CEYLON: LL[] = [
  [79.92, 9.75], [80.3, 9.8], [80.8, 9.25], [81.25, 8.55], [81.75, 7.7], [81.85, 7.0], [81.55, 6.4],
  [80.95, 6.0], [80.2, 6.03], [79.88, 6.9], [79.82, 7.8], [79.8, 8.6], [79.92, 9.2],
];

/** Land frontier of the playable subcontinent, from Arakan round the Himalaya to Baluchistan. */
const FRONTIER: LL[] = [
  [92.65, 21.6], [93.1, 22.4], [93.35, 23.5], [93.9, 24.0], [94.4, 24.3], [94.7, 25.3], [95.2, 26.2],
  [95.9, 26.9], [96.6, 27.3], [97.2, 27.9], [96.9, 28.4], [96.0, 29.1], [95.3, 29.0], [94.3, 29.3],
  [93.4, 28.6], [92.3, 27.85], [91.6, 27.95], [90.4, 28.2], [89.5, 28.1], [88.8, 28.0], [88.1, 27.85],
  [87.0, 27.95], [86.0, 28.1], [85.0, 28.4], [84.1, 28.75], [83.2, 29.4], [82.2, 30.0], [81.2, 30.35],
  [80.3, 30.55], [79.4, 30.95], [78.8, 31.3], [78.7, 32.1], [78.5, 32.6], [79.4, 32.9], [79.6, 33.7],
  [79.5, 34.5], [78.3, 35.4], [77.8, 35.55], [76.6, 35.9], [75.6, 36.4], [74.4, 36.5], [73.0, 36.4],
  [71.8, 36.3], [71.3, 35.6], [71.6, 34.9], [71.1, 34.1], [70.1, 34.0], [69.9, 33.1], [69.4, 32.0],
  [68.4, 31.6], [67.4, 31.25], [66.6, 30.95], [66.0, 30.3],
];

export const PLAYABLE: LL[] = [...COAST, ...FRONTIER];

export interface Range { pts: LL[]; h: number; w: number }

/** Mountain ranges as ridge lines: height h (0..1) and half-width w (degrees). */
export const RANGES: Range[] = [
  { h: 1.0, w: 1.1, pts: [[73.0, 35.3], [74.5, 34.6], [75.8, 33.6], [77.0, 32.6], [78.3, 31.3], [79.6, 30.6], [81.0, 30.0], [82.5, 29.3], [84.0, 28.6], [85.5, 28.1], [87.0, 27.9], [88.4, 27.8], [89.8, 27.8], [91.3, 27.9], [92.8, 28.1], [94.5, 28.6], [96.0, 28.6]] },
  { h: 0.9, w: 2.2, pts: [[78.5, 33.5], [80.5, 32.0], [83.0, 31.0], [86.0, 30.0], [90.0, 29.8], [94.0, 30.0], [97.5, 30.0]] },
  { h: 1.0, w: 0.9, pts: [[73.5, 36.3], [75.5, 35.9], [77.5, 35.4], [79.0, 35.0]] },
  { h: 0.85, w: 0.9, pts: [[67.5, 35.5], [69.5, 35.6], [71.5, 36.0], [73.0, 36.3]] },
  { h: 0.6, w: 1.4, pts: [[66.0, 33.5], [68.0, 33.8], [69.5, 33.6]] },
  { h: 0.55, w: 0.55, pts: [[69.9, 33.0], [69.8, 31.6], [69.6, 30.4], [69.0, 29.6]] },
  { h: 0.45, w: 0.55, pts: [[66.4, 30.6], [67.0, 29.4], [67.2, 28.0], [67.3, 26.6], [67.1, 25.6]] },
  { h: 0.3, w: 0.45, pts: [[77.0, 28.4], [75.9, 27.1], [74.8, 25.9], [73.7, 24.7], [72.8, 24.2]] },
  { h: 0.28, w: 0.45, pts: [[74.6, 22.7], [76.5, 23.1], [78.5, 23.5], [80.5, 24.3], [82.6, 24.7]] },
  { h: 0.33, w: 0.45, pts: [[73.9, 21.6], [75.5, 21.55], [77.3, 21.7], [79.0, 22.3], [81.0, 22.6], [81.8, 22.7]] },
  { h: 0.6, w: 0.38, pts: WESTERN_GHATS() },
  { h: 0.75, w: 0.4, pts: [[76.5, 11.4], [76.95, 11.3]] },
  { h: 0.3, w: 0.45, pts: [[78.6, 13.0], [79.1, 14.4], [78.9, 15.6], [80.3, 17.2], [81.8, 18.4], [83.2, 19.3], [84.5, 20.3]] },
  { h: 0.38, w: 0.38, pts: [[90.0, 25.5], [91.0, 25.55], [92.2, 25.4]] },
  { h: 0.55, w: 0.65, pts: [[96.0, 27.2], [95.0, 26.0], [94.3, 25.0], [93.6, 23.8], [93.0, 22.5], [92.7, 21.2], [93.5, 19.8], [94.3, 18.0]] },
];

function WESTERN_GHATS(): LL[] {
  return [[73.55, 21.0], [73.6, 20.0], [73.6, 19.0], [73.65, 18.0], [73.85, 17.0], [74.05, 16.0], [74.35, 15.0], [74.85, 14.0], [75.35, 13.0], [75.75, 12.0], [76.6, 11.4], [77.0, 10.3], [77.2, 9.3], [77.3, 8.5]];
}
export const GHATS = WESTERN_GHATS();

export interface Blob { c: LL; r: number; v: number }

/** Plateaus that raise the land (v = height added at the centre). */
export const PLATEAUS: Blob[] = [
  { c: [77.0, 17.5], r: 5.0, v: 0.2 },
  { c: [76.5, 13.8], r: 2.5, v: 0.1 },
  { c: [76.5, 23.4], r: 2.2, v: 0.12 },
  { c: [85.0, 23.3], r: 1.8, v: 0.2 },
  { c: [82.5, 22.0], r: 2.0, v: 0.12 },
  { c: [87.0, 33.0], r: 8.0, v: 0.7 },
  { c: [68.0, 34.5], r: 3.0, v: 0.4 },
  { c: [66.5, 28.5], r: 2.5, v: 0.35 },
  { c: [97.0, 22.0], r: 3.0, v: 0.35 },
];

/** Rainfall: negative is desert, positive is jungle. */
export const MOISTURE: Blob[] = [
  { c: [71.5, 27.0], r: 3.6, v: -0.75 },
  { c: [67.6, 27.2], r: 3.2, v: -0.65 },
  { c: [70.3, 23.9], r: 1.2, v: -0.5 },
  { c: [72.5, 30.5], r: 2.5, v: -0.25 },
  { c: [76.2, 17.5], r: 3.2, v: -0.22 },
  { c: [78.0, 14.8], r: 1.8, v: -0.2 },
  { c: [87.0, 33.0], r: 6.0, v: -0.45 },
  { c: [68.0, 34.0], r: 3.0, v: -0.4 },
  { c: [89.5, 24.0], r: 3.5, v: 0.35 },
  { c: [93.5, 25.8], r: 3.0, v: 0.4 },
  { c: [76.4, 10.2], r: 1.6, v: 0.3 },
  { c: [83.0, 28.0], r: 4.0, v: 0.15 },
  { c: [95.0, 19.0], r: 3.0, v: 0.3 },
  { c: [80.6, 7.4], r: 1.2, v: 0.3 },
];

export interface River { name: string; major: boolean; pts: LL[] }

export const RIVERS: River[] = [
  { name: 'Indus', major: true, pts: [[77.6, 34.1], [75.0, 35.3], [73.3, 35.6], [72.8, 34.5], [72.2, 33.9], [71.6, 32.9], [71.2, 31.5], [70.9, 30.3], [70.4, 29.3], [69.0, 28.0], [68.3, 26.8], [68.0, 25.9], [68.1, 25.2], [67.8, 24.5], [67.6, 24.0]] },
  { name: 'Jhelum', major: false, pts: [[75.0, 34.0], [74.0, 34.2], [73.5, 33.3], [73.5, 32.3], [72.4, 31.6], [72.1, 31.3]] },
  { name: 'Chenab', major: false, pts: [[75.7, 33.1], [74.5, 32.8], [73.5, 32.3], [72.5, 31.5], [71.9, 30.6], [71.1, 29.1]] },
  { name: 'Ravi', major: false, pts: [[76.4, 32.4], [75.4, 32.3], [74.3, 31.6], [73.2, 30.8], [71.9, 30.7]] },
  { name: 'Sutlej', major: false, pts: [[78.6, 31.6], [77.0, 31.4], [76.4, 31.0], [75.8, 31.0], [74.6, 30.9], [73.9, 30.0], [72.5, 29.4], [71.1, 29.0]] },
  { name: 'Ganga', major: true, pts: [[79.0, 30.9], [78.3, 30.1], [78.15, 29.95], [78.4, 29.0], [79.0, 28.2], [79.9, 27.4], [80.4, 26.6], [81.9, 25.45], [83.0, 25.3], [84.1, 25.55], [85.15, 25.62], [86.5, 25.35], [87.6, 25.2], [88.1, 24.8], [88.8, 24.2], [89.6, 23.8], [90.3, 23.5], [90.6, 23.0], [90.6, 22.4]] },
  { name: 'Hooghly', major: false, pts: [[88.1, 24.8], [88.3, 24.0], [88.4, 23.4], [88.35, 22.6], [88.1, 22.0]] },
  { name: 'Yamuna', major: false, pts: [[78.4, 31.0], [77.6, 30.3], [77.25, 29.0], [77.25, 28.6], [77.7, 27.5], [78.0, 27.18], [78.6, 26.9], [79.5, 26.2], [80.5, 25.8], [81.85, 25.43]] },
  { name: 'Chambal', major: false, pts: [[75.8, 22.6], [75.9, 24.0], [75.8, 25.2], [76.8, 26.0], [78.2, 26.5], [79.1, 26.45]] },
  { name: 'Ghaghara', major: false, pts: [[81.2, 28.5], [81.6, 27.3], [82.2, 26.8], [83.5, 26.2], [84.6, 25.7]] },
  { name: 'Gandak', major: false, pts: [[84.0, 27.5], [84.3, 26.7], [85.1, 25.65]] },
  { name: 'Kosi', major: false, pts: [[86.9, 26.9], [86.9, 26.2], [87.2, 25.4]] },
  { name: 'Son', major: false, pts: [[81.9, 22.7], [82.6, 24.0], [83.9, 24.7], [84.9, 25.6]] },
  { name: 'Brahmaputra', major: true, pts: [[95.6, 27.9], [94.9, 27.5], [93.8, 26.8], [92.8, 26.6], [91.75, 26.18], [90.0, 26.05], [89.7, 25.3], [89.7, 24.4], [89.8, 23.8]] },
  { name: 'Meghna', major: false, pts: [[91.9, 24.9], [91.0, 24.3], [90.7, 23.5], [90.6, 22.6]] },
  { name: 'Narmada', major: true, pts: [[81.7, 22.7], [80.5, 23.0], [79.9, 23.15], [78.7, 22.8], [77.7, 22.7], [76.4, 22.2], [75.5, 22.15], [74.4, 21.9], [73.6, 21.85], [73.0, 21.7], [72.65, 21.65]] },
  { name: 'Tapti', major: false, pts: [[78.3, 21.8], [77.0, 21.3], [76.2, 21.3], [75.0, 21.3], [74.0, 21.2], [73.3, 21.25], [72.75, 21.1]] },
  { name: 'Mahi', major: false, pts: [[74.8, 22.8], [73.9, 23.0], [73.2, 22.6], [72.75, 22.25]] },
  { name: 'Sabarmati', major: false, pts: [[73.3, 24.3], [72.6, 23.0], [72.45, 22.35]] },
  { name: 'Mahanadi', major: true, pts: [[81.9, 20.1], [82.0, 21.2], [83.0, 21.5], [83.95, 21.45], [84.6, 20.8], [85.4, 20.55], [85.9, 20.45], [86.6, 20.3]] },
  { name: 'Godavari', major: true, pts: [[73.5, 19.95], [73.8, 19.98], [74.9, 19.5], [75.7, 19.3], [76.6, 19.15], [77.3, 19.15], [78.3, 18.85], [79.3, 18.8], [80.0, 18.6], [80.6, 18.0], [81.3, 17.4], [81.8, 16.95], [82.2, 16.6], [82.3, 16.5]] },
  { name: 'Krishna', major: true, pts: [[73.66, 17.92], [74.0, 17.5], [74.55, 16.85], [75.2, 16.6], [75.9, 16.35], [76.6, 16.3], [77.3, 16.4], [78.3, 16.2], [78.87, 16.07], [79.31, 16.57], [80.0, 16.75], [80.6, 16.5], [80.9, 15.9], [81.0, 15.75]] },
  { name: 'Bhima', major: false, pts: [[73.55, 19.07], [74.3, 18.6], [75.0, 18.3], [75.6, 17.8], [76.2, 17.3], [76.9, 16.6], [77.3, 16.4]] },
  { name: 'Tungabhadra', major: false, pts: [[75.5, 13.9], [75.6, 14.2], [75.9, 14.7], [76.4, 15.3], [77.0, 15.6], [77.6, 15.9], [78.25, 15.95]] },
  { name: 'Kaveri', major: true, pts: [[75.6, 12.4], [76.2, 12.45], [76.7, 12.4], [77.3, 12.2], [77.8, 11.8], [78.4, 11.0], [78.7, 10.85], [79.15, 10.95], [79.85, 11.15]] },
  { name: 'Penner', major: false, pts: [[77.6, 13.6], [78.5, 14.5], [79.3, 14.5], [80.15, 14.6]] },
];

export const FOREIGN_LABELS: { name: string; at: LL; sea?: boolean }[] = [
  { name: 'TIBET', at: [86.5, 32.6] },
  { name: 'AFGHAN HIGHLANDS', at: [67.8, 34.4] },
  { name: 'KINGDOM OF AVA', at: [96.0, 21.6] },
  { name: 'KANDY', at: [80.7, 7.7] },
  { name: 'ARABIAN SEA', at: [68.5, 15.5], sea: true },
  { name: 'BAY OF BENGAL', at: [87.5, 15.0], sea: true },
  { name: 'INDIAN OCEAN', at: [74.0, 7.0], sea: true },
];

export type Owner = 'mar' | 'mug' | 'bij' | 'gol' | 'raj' | 'sid' | 'por' | 'eng' | 'nay' | 'mys' | 'aho' | 'ind';
export type Kind = 'fort' | 'city' | 'port';

export interface ProvinceDef {
  key: string;
  name: string;
  town: string;
  at: LL;
  kind: Kind;
  walls: number;
  wealth: number;
  owner: Owner;
  region: string;
  sea?: boolean;
}

const P = (
  key: string, name: string, town: string, lon: number, lat: number, kind: Kind,
  walls: number, wealth: number, owner: Owner, region: string, sea = false,
): ProvinceDef => ({ key, name, town, at: [lon, lat], kind, walls, wealth, owner, region, sea });

/** Provinces as they stood at the start of 1670, when Shivaji began retaking the Purandar forts. */
export const PROVINCES: ProvinceDef[] = [
  // Swarajya and the Konkan
  P('raigad', 'Raigad', 'Raigad Fort', 73.40, 18.28, 'fort', 3, 6, 'mar', 'Konkan'),
  P('javli', 'Javli', 'Pratapgad', 73.62, 17.88, 'fort', 3, 4, 'mar', 'Desh'),
  P('dabhol', 'Dabhol', 'Dabhol', 73.35, 17.45, 'port', 1, 5, 'mar', 'Konkan'),
  P('rajapur', 'Rajapur', 'Vishalgad', 73.58, 16.80, 'fort', 3, 4, 'mar', 'Konkan'),
  P('malvan', 'Malvan', 'Sindhudurg', 73.55, 16.05, 'fort', 3, 4, 'mar', 'Konkan', true),
  P('janjira', 'Janjira', 'Murud-Janjira', 72.98, 18.30, 'fort', 3, 4, 'sid', 'Konkan', true),
  P('kalyan', 'Kalyan', 'Mahuli', 73.30, 19.30, 'fort', 2, 5, 'mug', 'Konkan'),
  P('bombay', 'Bombay', 'Bombay Castle', 72.88, 18.98, 'port', 2, 6, 'eng', 'Konkan'),
  P('bassein', 'Bassein', 'Bassein Fort', 72.90, 19.62, 'port', 2, 5, 'por', 'Konkan'),
  // Desh: the Purandar forts held by the Mughals
  P('pune', 'Pune', 'Kondhana (Sinhagad)', 73.90, 18.42, 'fort', 3, 5, 'mug', 'Desh'),
  P('saswad', 'Saswad', 'Purandar', 74.25, 18.05, 'fort', 3, 3, 'mug', 'Desh'),
  P('junnar', 'Junnar', 'Shivneri', 73.86, 19.20, 'fort', 3, 4, 'mug', 'Desh'),
  P('satara', 'Satara', 'Ajinkyatara', 74.00, 17.60, 'fort', 3, 4, 'bij', 'Desh'),
  P('kolhapur', 'Kolhapur', 'Panhala', 74.15, 16.80, 'fort', 3, 5, 'bij', 'Desh'),
  P('miraj', 'Miraj', 'Miraj', 74.65, 16.82, 'fort', 2, 4, 'bij', 'Desh'),
  // Mughal Deccan
  P('nashik', 'Nashik', 'Trimbak', 73.80, 20.00, 'fort', 2, 5, 'mug', 'Mughal Deccan'),
  P('baglan', 'Baglan', 'Salher', 74.05, 20.70, 'fort', 3, 3, 'mug', 'Mughal Deccan'),
  P('ahmednagar', 'Ahmednagar', 'Ahmednagar Fort', 74.74, 19.09, 'fort', 2, 6, 'mug', 'Mughal Deccan'),
  P('aurangabad', 'Aurangabad', 'Daulatabad', 75.30, 19.90, 'fort', 3, 9, 'mug', 'Mughal Deccan'),
  P('bid', 'Bid', 'Dharur', 75.85, 18.85, 'fort', 1, 4, 'mug', 'Mughal Deccan'),
  P('nanded', 'Nanded', 'Nanded', 77.32, 19.15, 'city', 1, 4, 'mug', 'Mughal Deccan'),
  P('bidar', 'Bidar', 'Bidar Fort', 77.52, 17.92, 'fort', 2, 6, 'mug', 'Mughal Deccan'),
  P('khandesh', 'Khandesh', 'Asirgarh', 76.23, 21.35, 'fort', 3, 8, 'mug', 'Khandesh & Berar'),
  P('berar', 'Berar', 'Gawilgarh', 77.40, 21.20, 'fort', 3, 6, 'mug', 'Khandesh & Berar'),
  // Gujarat
  P('surat', 'Surat', 'Surat', 72.92, 21.17, 'port', 1, 14, 'mug', 'Gujarat'),
  P('daman', 'Daman', 'Daman', 72.90, 20.42, 'port', 2, 4, 'por', 'Gujarat'),
  P('baroda', 'Baroda', 'Baroda', 73.20, 22.30, 'city', 1, 6, 'mug', 'Gujarat'),
  P('ahmedabad', 'Ahmedabad', 'Ahmedabad', 72.60, 23.03, 'city', 2, 12, 'mug', 'Gujarat'),
  P('patan', 'Patan', 'Patan', 72.15, 23.85, 'city', 1, 4, 'mug', 'Gujarat'),
  P('sorath', 'Sorath', 'Junagadh', 70.46, 21.52, 'fort', 2, 5, 'mug', 'Gujarat'),
  P('diu', 'Diu', 'Diu Fort', 71.00, 20.82, 'port', 2, 4, 'por', 'Gujarat'),
  P('halar', 'Halar', 'Navanagar', 70.06, 22.38, 'city', 1, 4, 'ind', 'Gujarat'),
  P('kutch', 'Kutch', 'Bhuj', 69.67, 23.25, 'fort', 2, 4, 'ind', 'Gujarat'),
  // Malwa and Bundelkhand
  P('ujjain', 'Ujjain', 'Ujjain', 75.78, 23.18, 'city', 1, 7, 'mug', 'Malwa'),
  P('mandu', 'Mandu', 'Mandu', 75.40, 22.35, 'fort', 3, 4, 'mug', 'Malwa'),
  P('bhopal', 'Bhopal', 'Raisen', 77.70, 23.30, 'fort', 2, 4, 'mug', 'Malwa'),
  P('chanderi', 'Chanderi', 'Chanderi', 78.13, 24.72, 'fort', 2, 4, 'mug', 'Malwa'),
  P('orchha', 'Bundelkhand', 'Orchha', 78.64, 25.35, 'fort', 2, 4, 'ind', 'Malwa'),
  P('kalinjar', 'Kalinjar', 'Kalinjar Fort', 80.48, 25.00, 'fort', 3, 3, 'ind', 'Malwa'),
  // Hindustan
  P('delhi', 'Delhi', 'Shahjahanabad', 77.22, 28.65, 'city', 3, 16, 'mug', 'Hindustan'),
  P('agra', 'Agra', 'Agra Fort', 78.00, 27.18, 'fort', 3, 14, 'mug', 'Hindustan'),
  P('gwalior', 'Gwalior', 'Gwalior Fort', 78.18, 26.22, 'fort', 3, 6, 'mug', 'Hindustan'),
  P('mewat', 'Mewat', 'Alwar', 76.60, 27.56, 'fort', 2, 4, 'mug', 'Hindustan'),
  P('hisar', 'Hisar', 'Hisar', 75.72, 29.15, 'city', 1, 4, 'mug', 'Hindustan'),
  P('katehar', 'Katehar', 'Bareilly', 79.42, 28.37, 'city', 1, 5, 'mug', 'Hindustan'),
  // Rajputana
  P('ajmer', 'Ajmer', 'Taragarh', 74.64, 26.45, 'fort', 3, 6, 'mug', 'Rajputana'),
  P('amber', 'Amber', 'Amber Fort', 75.85, 26.98, 'fort', 3, 8, 'raj', 'Rajputana'),
  P('mewar', 'Mewar', 'Kumbhalgarh', 73.58, 25.15, 'fort', 3, 5, 'raj', 'Rajputana'),
  P('chittor', 'Chittor', 'Chittorgarh', 74.63, 24.89, 'fort', 3, 4, 'raj', 'Rajputana'),
  P('marwar', 'Marwar', 'Mehrangarh', 73.02, 26.30, 'fort', 3, 6, 'raj', 'Rajputana'),
  P('bikaner', 'Bikaner', 'Junagarh', 73.31, 28.02, 'fort', 2, 4, 'raj', 'Rajputana'),
  P('jaisalmer', 'Jaisalmer', 'Jaisalmer Fort', 70.91, 26.92, 'fort', 3, 3, 'raj', 'Rajputana'),
  P('hadoti', 'Hadoti', 'Bundi', 75.65, 25.25, 'fort', 2, 5, 'raj', 'Rajputana'),
  // Punjab, Kashmir and the hills
  P('sirhind', 'Sirhind', 'Sirhind', 76.40, 30.65, 'city', 1, 6, 'mug', 'Punjab'),
  P('lahore', 'Lahore', 'Lahore Fort', 74.33, 31.58, 'city', 3, 12, 'mug', 'Punjab'),
  P('multan', 'Multan', 'Multan', 71.47, 30.20, 'city', 2, 8, 'mug', 'Punjab'),
  P('peshawar', 'Peshawar', 'Peshawar', 71.58, 34.00, 'city', 1, 5, 'mug', 'Punjab'),
  P('kangra', 'Kangra', 'Kangra Fort', 76.27, 32.10, 'fort', 3, 4, 'mug', 'Punjab'),
  P('kashmir', 'Kashmir', 'Srinagar', 74.80, 34.08, 'city', 1, 7, 'mug', 'Kashmir & Hills'),
  P('jammu', 'Jammu', 'Jammu', 74.86, 32.73, 'fort', 1, 3, 'ind', 'Kashmir & Hills'),
  P('ladakh', 'Ladakh', 'Leh', 77.58, 34.16, 'city', 1, 2, 'ind', 'Kashmir & Hills'),
  P('garhwal', 'Garhwal', 'Srinagar-Garhwal', 78.78, 30.22, 'city', 1, 3, 'ind', 'Kashmir & Hills'),
  P('kumaon', 'Kumaon', 'Almora', 79.66, 29.60, 'city', 1, 3, 'ind', 'Kashmir & Hills'),
  P('nepal', 'Nepal', 'Kathmandu', 85.32, 27.70, 'city', 1, 6, 'ind', 'Kashmir & Hills'),
  // Sindh and Baluchistan
  P('thatta', 'Thatta', 'Thatta', 67.92, 24.75, 'city', 1, 6, 'mug', 'Sindh'),
  P('sehwan', 'Sehwan', 'Sehwan', 67.86, 26.43, 'city', 1, 3, 'mug', 'Sindh'),
  P('bhakkar', 'Bhakkar', 'Bhakkar', 68.90, 27.70, 'fort', 2, 4, 'mug', 'Sindh'),
  P('umarkot', 'Umarkot', 'Umarkot', 69.73, 25.36, 'fort', 1, 2, 'mug', 'Sindh'),
  P('kalat', 'Kalat', 'Kalat', 66.60, 29.03, 'fort', 2, 2, 'ind', 'Sindh'),
  // Awadh and Bihar
  P('awadh', 'Awadh', 'Lucknow', 80.95, 26.85, 'city', 1, 8, 'mug', 'Awadh & Bihar'),
  P('allahabad', 'Allahabad', 'Allahabad Fort', 81.85, 25.44, 'fort', 2, 8, 'mug', 'Awadh & Bihar'),
  P('jaunpur', 'Jaunpur', 'Jaunpur', 82.68, 25.75, 'city', 1, 6, 'mug', 'Awadh & Bihar'),
  P('gorakhpur', 'Gorakhpur', 'Gorakhpur', 83.37, 26.76, 'city', 1, 4, 'mug', 'Awadh & Bihar'),
  P('bihar', 'Bihar', 'Patna', 85.14, 25.60, 'city', 2, 10, 'mug', 'Awadh & Bihar'),
  P('rohtas', 'Rohtas', 'Rohtasgarh', 83.90, 24.62, 'fort', 3, 4, 'mug', 'Awadh & Bihar'),
  P('munger', 'Munger', 'Munger', 86.47, 25.37, 'fort', 2, 5, 'mug', 'Awadh & Bihar'),
  P('palamu', 'Palamu', 'Palamu Fort', 84.10, 23.90, 'fort', 2, 3, 'mug', 'Awadh & Bihar'),
  P('nagpuri', 'Chota Nagpur', 'Navratangarh', 85.00, 23.30, 'fort', 1, 2, 'ind', 'Awadh & Bihar'),
  // Bengal and Orissa
  P('rajmahal', 'Rajmahal', 'Rajmahal', 87.85, 25.05, 'city', 1, 8, 'mug', 'Bengal'),
  P('hooghly', 'Hooghly', 'Hooghly', 88.40, 22.90, 'port', 1, 9, 'mug', 'Bengal'),
  P('dhaka', 'Dhaka', 'Dhaka', 90.40, 23.72, 'city', 2, 12, 'mug', 'Bengal'),
  P('chittagong', 'Chittagong', 'Chittagong', 91.80, 22.40, 'port', 1, 5, 'mug', 'Bengal'),
  P('sylhet', 'Sylhet', 'Sylhet', 91.87, 24.90, 'city', 1, 4, 'mug', 'Bengal'),
  P('kochbehar', 'Koch Behar', 'Cooch Behar', 89.45, 26.32, 'city', 1, 4, 'ind', 'Bengal'),
  P('tripura', 'Tripura', 'Udaipur', 91.48, 23.53, 'city', 1, 3, 'ind', 'Bengal'),
  P('orissa', 'Orissa', 'Cuttack', 85.88, 20.46, 'fort', 2, 7, 'mug', 'Orissa'),
  P('puri', 'Puri', 'Puri', 85.70, 19.85, 'city', 1, 5, 'mug', 'Orissa'),
  // Assam
  P('kamrup', 'Kamrup', 'Guwahati', 91.74, 26.16, 'fort', 2, 6, 'aho', 'Assam'),
  P('darrang', 'Darrang', 'Tezpur', 92.80, 26.62, 'city', 1, 4, 'aho', 'Assam'),
  P('garhgaon', 'Upper Assam', 'Garhgaon', 94.60, 26.95, 'city', 2, 6, 'aho', 'Assam'),
  P('manipur', 'Manipur', 'Imphal', 93.94, 24.81, 'city', 1, 3, 'ind', 'Assam'),
  // Gondwana
  P('deogarh', 'Deogarh', 'Nagpur', 79.08, 21.15, 'fort', 1, 4, 'ind', 'Gondwana'),
  P('chanda', 'Chanda', 'Chanda', 79.30, 19.95, 'fort', 2, 3, 'ind', 'Gondwana'),
  P('garha', 'Garha', 'Garha-Mandla', 79.95, 23.17, 'fort', 1, 3, 'ind', 'Gondwana'),
  P('ratanpur', 'Chhattisgarh', 'Ratanpur', 82.15, 22.30, 'city', 1, 3, 'ind', 'Gondwana'),
  P('bastar', 'Bastar', 'Jagdalpur', 82.02, 19.08, 'city', 0, 2, 'ind', 'Gondwana'),
  // Bijapur
  P('bijapur', 'Bijapur', 'Bijapur', 75.71, 16.83, 'city', 3, 12, 'bij', 'Bijapur'),
  P('solapur', 'Solapur', 'Solapur Fort', 75.90, 17.68, 'fort', 2, 5, 'bij', 'Bijapur'),
  P('gulbarga', 'Gulbarga', 'Gulbarga', 76.83, 17.33, 'fort', 2, 6, 'bij', 'Bijapur'),
  P('raichur', 'Raichur', 'Raichur', 77.35, 16.20, 'fort', 2, 6, 'bij', 'Bijapur'),
  P('belgaum', 'Belgaum', 'Belgaum', 74.50, 15.85, 'fort', 2, 5, 'bij', 'Bijapur'),
  P('dharwar', 'Dharwar', 'Dharwar', 75.05, 15.45, 'fort', 2, 5, 'bij', 'Bijapur'),
  P('karwar', 'Karwar', 'Karwar', 74.22, 14.82, 'port', 1, 4, 'bij', 'Bijapur'),
  P('adoni', 'Adoni', 'Adoni', 77.27, 15.63, 'fort', 3, 4, 'bij', 'Bijapur'),
  P('bellary', 'Vijayanagara', 'Bellary', 76.50, 15.15, 'fort', 2, 4, 'bij', 'Bijapur'),
  P('kurnool', 'Kurnool', 'Kurnool', 78.05, 15.83, 'fort', 1, 4, 'bij', 'Bijapur'),
  // Goa and the Kanara coast
  P('goa', 'Goa', 'Goa', 73.92, 15.45, 'port', 2, 10, 'por', 'Kanara'),
  P('keladi', 'Keladi', 'Ikkeri', 75.00, 14.10, 'fort', 2, 5, 'ind', 'Kanara'),
  P('tulunad', 'Tulu Nadu', 'Mangalore', 74.95, 12.90, 'port', 1, 5, 'ind', 'Kanara'),
  P('chitradurga', 'Chitradurga', 'Chitradurga', 76.40, 14.23, 'fort', 3, 3, 'ind', 'Kanara'),
  // Golconda
  P('golconda', 'Golconda', 'Golconda Fort', 78.40, 17.38, 'fort', 3, 14, 'gol', 'Golconda'),
  P('warangal', 'Warangal', 'Warangal', 79.60, 17.97, 'fort', 2, 5, 'gol', 'Golconda'),
  P('nalgonda', 'Nalgonda', 'Devarakonda', 79.15, 16.85, 'fort', 2, 3, 'gol', 'Golconda'),
  P('kondapalli', 'Kondapalli', 'Kondapalli', 80.55, 16.65, 'fort', 2, 4, 'gol', 'Golconda'),
  P('masulipatam', 'Masulipatam', 'Machilipatnam', 81.10, 16.22, 'port', 1, 9, 'gol', 'Golconda'),
  P('rajahmundry', 'Rajahmundry', 'Rajahmundry', 81.78, 17.00, 'city', 1, 5, 'gol', 'Golconda'),
  P('chicacole', 'Chicacole', 'Srikakulam', 83.60, 18.25, 'city', 1, 4, 'gol', 'Golconda'),
  P('cuddapah', 'Cuddapah', 'Gandikota', 78.80, 14.60, 'fort', 3, 4, 'gol', 'Golconda'),
  P('nellore', 'Nellore', 'Udayagiri', 79.95, 14.50, 'fort', 2, 5, 'gol', 'Golconda'),
  // The Carnatic
  P('bangalore', 'Bangalore', 'Bangalore', 77.59, 12.97, 'fort', 2, 6, 'bij', 'Carnatic'),
  P('sira', 'Sira', 'Sira', 76.90, 13.74, 'fort', 1, 4, 'bij', 'Carnatic'),
  P('penukonda', 'Penukonda', 'Penukonda', 77.60, 14.08, 'fort', 2, 3, 'bij', 'Carnatic'),
  P('vellore', 'Vellore', 'Vellore Fort', 79.13, 12.92, 'fort', 3, 5, 'bij', 'Carnatic'),
  P('gingee', 'Gingee', 'Gingee', 79.40, 12.25, 'fort', 3, 5, 'bij', 'Carnatic'),
  P('madras', 'Madras', 'Fort St. George', 80.26, 13.15, 'port', 2, 7, 'eng', 'Carnatic'),
  // The far south
  P('mysore', 'Mysore', 'Srirangapatna', 76.68, 12.42, 'fort', 3, 8, 'mys', 'Mysore'),
  P('hassan', 'Hassan', 'Hassan', 76.10, 13.00, 'city', 1, 4, 'mys', 'Mysore'),
  P('madurai', 'Madurai', 'Madurai', 78.12, 9.93, 'city', 2, 9, 'nay', 'Tamil Nadu'),
  P('thanjavur', 'Thanjavur', 'Thanjavur', 79.14, 10.79, 'fort', 2, 8, 'nay', 'Tamil Nadu'),
  P('trichy', 'Trichinopoly', 'Rockfort', 78.70, 10.80, 'fort', 3, 6, 'nay', 'Tamil Nadu'),
  P('tirunelveli', 'Tirunelveli', 'Palayamkottai', 77.75, 8.78, 'city', 1, 5, 'nay', 'Tamil Nadu'),
  P('ramnad', 'Ramnad', 'Ramanathapuram', 78.83, 9.40, 'city', 1, 3, 'nay', 'Tamil Nadu'),
  P('salem', 'Salem', 'Salem', 78.15, 11.65, 'city', 1, 4, 'nay', 'Tamil Nadu'),
  P('kongu', 'Kongu', 'Coimbatore', 77.00, 11.00, 'city', 1, 4, 'nay', 'Tamil Nadu'),
  P('calicut', 'Calicut', 'Calicut', 75.82, 11.28, 'port', 1, 7, 'ind', 'Malabar'),
  P('cochin', 'Cochin', 'Cochin', 76.32, 9.97, 'port', 1, 6, 'ind', 'Malabar'),
  P('venad', 'Venad', 'Padmanabhapuram', 77.05, 8.55, 'fort', 1, 5, 'ind', 'Malabar'),
];
