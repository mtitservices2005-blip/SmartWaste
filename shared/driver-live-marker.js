// SW-098: punto del conductor en el mapa "En ruta". Puro respecto al DOM: recibe Leaflet (L) y el mapa.
// - Punto con relleno de color y borde blanco (antes el relleno quedaba blanco y no se veía).
// - Círculo tenue con la precisión del GPS.
// - El mapa sigue al conductor; si lo arrastra deja de seguir hasta recenter().
export const FOLLOW_ZOOM = 17;
export const MIN_FOLLOW_ZOOM = 16;
export const MAX_DISPLAY_ACCURACY_METERS = 100;

export function createLiveMarker({ L, map, color = '#3d7a00', onFollowChange = () => {} }) {
  let dot = null;
  let ring = null;
  let last = null;
  let following = true;

  const setFollowing = (value) => {
    if (following === value) return;
    following = value;
    onFollowChange(following);
  };
  map.on?.('dragstart', () => setFollowing(false));

  const follow = (p) => {
    if (map.getZoom() >= MIN_FOLLOW_ZOOM) map.panTo(p);
    else map.setView(p, FOLLOW_ZOOM);
  };

  return {
    update(position) {
      const lat = Number(position?.latitude);
      const lng = Number(position?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const accuracy = Number.isFinite(Number(position.accuracy)) ? Number(position.accuracy) : null;
      if (accuracy !== null && accuracy > MAX_DISPLAY_ACCURACY_METERS) return false;
      const p = [lat, lng];
      last = p;
      if (dot) dot.setLatLng(p);
      else dot = L.circleMarker(p, { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(map);
      if (accuracy !== null) {
        if (ring) { ring.setLatLng(p); ring.setRadius(accuracy); }
        else ring = L.circle(p, { radius: accuracy, color, weight: 1, fillColor: color, fillOpacity: 0.12, interactive: false }).addTo(map);
      }
      if (following) follow(p);
      return true;
    },
    recenter() {
      setFollowing(true);
      if (last) follow(last);
    },
    isFollowing: () => following
  };
}
