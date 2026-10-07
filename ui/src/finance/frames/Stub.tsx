/**
 * A frame the design has not reached yet.
 *
 * Invest, Plan and Transactions are in the rail because the rail is what the
 * design approved, but their frames are listed under *Open decisions* as not
 * yet designed. Saying so plainly beats inventing a layout that will be thrown
 * away, and beats a rail item that silently does nothing.
 */
export default function Stub({ title, note }: { title: string; note: string }) {
  return (
    <div className="fin-stub">
      <span className="fin-stub__glyph" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  );
}
