import Composer from "./Composer";

// The studio opens on the thing people came to do: write something.
//
// It used to be a grid of eight category cards — a menu that led to another menu. The
// categories still exist and are still linked below the composer, but choosing one is no
// longer the price of entry.
export default function StudioHome() {
  return (
    <section className="st-section">
      <Composer heading="What do you want to create?" />
    </section>
  );
}
