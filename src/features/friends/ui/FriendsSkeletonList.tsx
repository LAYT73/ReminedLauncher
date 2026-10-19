export function FriendsSkeletonList() {
  return (
    <ul
      className="friends-list"
      aria-busy="true"
      aria-label="Loading friends"
    >
      {[0, 1, 2].map((i) => (
        <li key={i} className="friend-row has-join is-skeleton">
          <span className="skel skel-avatar" />
          <div className="friend-copy">
            <div className="friend-name-row">
              <span className="skel skel-line skel-name" />
              <span className="skel skel-status" />
            </div>
            <span className="skel skel-line skel-id" />
          </div>
          <span className="skel skel-chip" />
          <span className="skel skel-chip skel-chip-narrow" />
        </li>
      ))}
    </ul>
  );
}
