import { formatStars } from '@/lib/format';

/**
 * Placeholder shell. Routing, layout and the actual screens arrive with
 * milestones M7 and M8.
 */
export default function App() {
  return (
    <main>
      <h1>product-rating</h1>
      <p>Projektgerüst steht. Die Oberfläche folgt mit Meilenstein M7.</p>
      <p aria-label="Beispielbewertung: 4 von 5 Sternen">{formatStars(4)}</p>
    </main>
  );
}
