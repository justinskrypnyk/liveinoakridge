// City of London open-data map layers for /admin/comps/ (Justin, 2026-10-13).
// Drawn by the City's own ArcGIS server (maps.london.ca, OpenData services)
// as image tiles, restyled here through `dynamicLayers` -- the published
// layers are all one flat colour. City of London only: no towns.
// Checked 2026-10-13: zoning last edited 2026-09-29; parcel area is m².

const SVC = 'https://maps.london.ca/server/rest/services/OpenData';

type Rgba = [number, number, number, number];
const fill = (color: Rgba, outline: Rgba, width = 0.6, style = 'esriSFSSolid') => ({
  type: 'esriSFS', style, color, outline: { type: 'esriSLS', style: 'esriSLSSolid', color: outline, width },
});
const line = (color: Rgba, width: number, style = 'esriSLSSolid') => ({ type: 'esriSLS', style, color, width });
const label = (field: string, minScale: number, size = 9) => ({
  labelExpression: `[${field}]`, minScale,
  labelPlacement: 'esriServerPolygonPlacementAlwaysHorizontal',
  symbol: { type: 'esriTS', color: [30, 30, 30, 255], haloColor: [255, 255, 255, 255], haloSize: 1.5, font: { family: 'Arial', size, weight: 'bold' } },
});

// Zoning colours by the City's GeneralizedLandUse; also the map legend.
export const ZONING_COLOURS: Record<string, { label: string; rgb: [number, number, number] }> = {
  RESIDENTIAL: { label: 'Residential', rgb: [250, 214, 90] },
  COMMERCIAL: { label: 'Commercial', rgb: [226, 74, 74] },
  INDUSTRIAL: { label: 'Industrial', rgb: [150, 96, 200] },
  INSTITUTIONAL: { label: 'Institutional', rgb: [70, 130, 220] },
  'OPEN SPACE': { label: 'Open space', rgb: [70, 170, 90] },
  AGRICULTURAL: { label: 'Agricultural', rgb: [190, 160, 110] },
  'URBAN RESERVE': { label: 'Urban reserve', rgb: [160, 160, 160] },
  RAILWAY: { label: 'Railway', rgb: [90, 90, 90] },
};

type Sub = { service: string; id: number; drawingInfo: Record<string, unknown> };
export type CityLayer = { key: string; label: string; minZoom: number; swatch: string; subs: Sub[] };

export const CITY_LAYERS: CityLayer[] = [
  {
    key: 'zoning', label: 'Zoning', minZoom: 13, swatch: 'rgb(250,214,90)',
    subs: [{
      service: 'OpenData_Community', id: 16,
      drawingInfo: {
        renderer: {
          type: 'uniqueValue', field1: 'GeneralizedLandUse',
          defaultSymbol: fill([200, 200, 200, 90], [90, 90, 90, 200]),
          uniqueValueInfos: Object.entries(ZONING_COLOURS).map(([value, { rgb }]) => ({ value, symbol: fill([...rgb, 95], [...rgb.map((c) => Math.round(c * 0.55)), 230] as Rgba) })),
        },
        labelingInfo: [label('GIS_FeatureKey', 20000)], showLabels: true,
      },
    }],
  },
  {
    key: 'lots', label: 'Lot lines', minZoom: 16, swatch: '#0c2340',
    subs: [{ service: 'OpenData_BaseMaps', id: 53, drawingInfo: { renderer: { type: 'simple', symbol: fill([0, 0, 0, 0], [12, 35, 64, 200], 0.8) } } }],
  },
  {
    key: 'heritage', label: 'Heritage', minZoom: 12, swatch: '#c026d3',
    subs: [
      { service: 'OpenData_Community', id: 6, drawingInfo: { renderer: { type: 'simple', symbol: fill([192, 38, 211, 160], [162, 28, 175, 255], 2, 'esriSFSBackwardDiagonal') }, labelingInfo: [label('GIS_FeatureKey', 40000, 10)], showLabels: true } },
      { service: 'OpenData_Community', id: 7, drawingInfo: { renderer: { type: 'simple', symbol: fill([234, 88, 12, 70], [154, 52, 18, 220], 0.7) } } },
    ],
  },
  {
    key: 'hydro', label: 'Hydro lines & railways', minZoom: 11, swatch: '#7c3aed',
    subs: [
      { service: 'OpenData_BaseMaps', id: 44, drawingInfo: { renderer: { type: 'simple', symbol: line([124, 58, 237, 255], 3) } } },
      { service: 'OpenData_BaseMaps', id: 27, drawingInfo: { renderer: { type: 'simple', symbol: line([30, 30, 30, 255], 2.5, 'esriSLSDash') } } },
    ],
  },
  {
    key: 'parks', label: 'Parks & trails', minZoom: 12, swatch: '#16a34a',
    subs: [
      { service: 'OpenData_Recreation', id: 3, drawingInfo: { renderer: { type: 'simple', symbol: fill([22, 163, 74, 70], [21, 128, 61, 220], 0.8) } } },
      { service: 'OpenData_Recreation', id: 2, drawingInfo: { renderer: { type: 'simple', symbol: line([146, 64, 14, 230], 1.8, 'esriSLSDot') } } },
    ],
  },
  {
    key: 'schools', label: 'Schools', minZoom: 12, swatch: '#2563eb',
    subs: [{
      service: 'OpenData_Community', id: 4,
      drawingInfo: {
        renderer: { type: 'simple', symbol: { type: 'esriSMS', style: 'esriSMSSquare', color: [37, 99, 235, 255], size: 9, outline: { color: [255, 255, 255, 255], width: 1.5 } } },
        labelingInfo: [{ ...label('ShortName', 40000), labelPlacement: 'esriServerPointLabelPlacementAboveCenter' }], showLabels: true,
      },
    }],
  },
  {
    key: 'vacant', label: 'Vacant / future development', minZoom: 12, swatch: '#0891b2',
    subs: [{ service: 'OpenData_Community', id: 20, drawingInfo: { renderer: { type: 'simple', symbol: fill([8, 145, 178, 130], [14, 116, 144, 255], 1.2, 'esriSFSForwardDiagonal') } } }],
  },
];

/** Export-image URL for one layer over a Web Mercator box (one map tile). */
export function cityTileUrl(layer: CityLayer, bbox3857: [number, number, number, number], px = 512) {
  // All of a layer's sublayers come from one service per request.
  const service = layer.subs[0].service;
  const dynamicLayers = layer.subs.map((s) => ({ id: s.id, source: { type: 'mapLayer', mapLayerId: s.id }, drawingInfo: s.drawingInfo }));
  const q = new URLSearchParams({
    bbox: bbox3857.join(','), bboxSR: '3857', imageSR: '3857', size: `${px},${px}`, dpi: String(96 * (px / 256)),
    format: 'png32', transparent: 'true', f: 'image', dynamicLayers: JSON.stringify(dynamicLayers),
  });
  return `${SVC}/${service}/MapServer/export?${q}`;
}

export const CITY_QUERY_BASE = SVC;
export const UTRCA_MAP_URL = 'https://maps.thamesriver.on.ca/gvh/?viewer=regulations';
