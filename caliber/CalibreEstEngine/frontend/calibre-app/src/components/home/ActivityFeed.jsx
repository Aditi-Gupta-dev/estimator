import { RECENT_ACTIVITY } from '../../constants/activity';

export function ActivityFeed() {
  return (
    <section className="activity-section" aria-label="Recent activity">
      <div className="activity-header">
        <div className="activity-title">Recent Activity</div>
        <button className="activity-view-all" aria-label="View full activity log">
          View All →
        </button>
      </div>

      <div className="activity-list" role="list">
        {RECENT_ACTIVITY.map((item) => (
          <div
            className="activity-item"
            key={item.id}
            role="listitem"
            tabIndex={0}
            aria-label={item.description}
          >
            <div
              className="activity-dot"
              style={{ background: item.color }}
            />
            <div className="activity-text">
              {item.description}
            </div>
            <div className="activity-meta">
              <span
                className="activity-role-tag"
                style={{
                  background: `${item.color}18`,
                  color: item.color,
                  border: `1px solid ${item.color}40`,
                }}
              >
                {item.roleTag}
              </span>
              <span className="activity-time">{item.time}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
