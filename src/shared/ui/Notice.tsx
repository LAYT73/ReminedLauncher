/** Simple titled placeholder (offline / signed-out states of online tabs). */
export function NoticePage({ title, text }: { title: string; text: string }) {
  return (
    <section className="section">
      <h2 className="page-title">{title}</h2>
      <p className="friends-lead">{text}</p>
    </section>
  );
}
