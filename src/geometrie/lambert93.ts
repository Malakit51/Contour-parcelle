// Conversion GPS (WGS84, degrés) → Lambert 93 (RGF93, EPSG:2154, mètres), le système officiel
// en France. RGF93 et WGS84 sont confondus ici (écart de quelques dizaines de cm au plus, comme
// les logiciels qui ne font pas de transformation de datum).

import type { LatLon } from './plan';

const A = 6378137; // demi-grand axe GRS80 (m)
const F = 1 / 298.257222101;
const E = Math.sqrt(2 * F - F * F);
const RAD = Math.PI / 180;
const LAT0 = 46.5 * RAD;
const LON0 = 3 * RAD;
const LAT1 = 49 * RAD;
const LAT2 = 44 * RAD;
const X0 = 700000;
const Y0 = 6600000;

const m = (lat: number) => Math.cos(lat) / Math.sqrt(1 - E * E * Math.sin(lat) ** 2);
const t = (lat: number) =>
  Math.tan(Math.PI / 4 - lat / 2) / ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2);

const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)));
const FF = m(LAT1) / (N * t(LAT1) ** N);
const RHO0 = A * FF * t(LAT0) ** N;

/** [x, y] en Lambert 93 (mètres) du point [latitude, longitude]. */
export function versLambert93(p: LatLon): [number, number] {
  const lat = p[0] * RAD;
  const lon = p[1] * RAD;
  const rho = A * FF * t(lat) ** N;
  const theta = N * (lon - LON0);
  return [X0 + rho * Math.sin(theta), Y0 + RHO0 - rho * Math.cos(theta)];
}

/** Description du système pour le fichier .prj (format ESRI). */
export const PRJ_LAMBERT93 =
  'PROJCS["RGF_1993_Lambert_93",GEOGCS["GCS_RGF_1993",DATUM["D_RGF_1993",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",700000.0],PARAMETER["False_Northing",6600000.0],PARAMETER["Central_Meridian",3.0],PARAMETER["Standard_Parallel_1",49.0],PARAMETER["Standard_Parallel_2",44.0],PARAMETER["Latitude_Of_Origin",46.5],UNIT["Meter",1.0]]';
