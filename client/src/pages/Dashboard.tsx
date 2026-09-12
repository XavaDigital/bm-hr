import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, List, Row, Spin, Statistic, Tag, Typography, App as AntApp } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeError } from '../api';
import { date, money } from '../format';
import { LEAVE_TYPE_LABELS, RUN_STATUS_COLOR, RUN_STATUS_LABELS, type Dashboard as DashboardData } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Section<T>({ title, items, render, empty, extra }: { title: string; items: T[]; render: (t: T) => React.ReactNode; empty: string; extra?: React.ReactNode }) {
  return (
    <Card size="small" title={title} extra={extra} style={{ height: '100%' }}>
      {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} /> : <List size="small" dataSource={items} renderItem={(i) => <List.Item>{render(i)}</List.Item>} />}
    </Card>
  );
}

export function Dashboard() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [d, setD] = useState<DashboardData | null>(null);

  useEffect(() => {
    api<DashboardData>('/api/dashboard')
      .then(setD)
      .catch((e) => message.error(describeError(e)));
  }, [message]);

  if (!d) {
    return (
      <div className="page">
        <Spin />
      </div>
    );
  }

  const pr = d.payRuns;
  return (
    <div className="page">
      <div className="page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Today
        </Typography.Title>
        <Typography.Text className="muted">{date(d.today)}</Typography.Text>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Active" value={d.counts.active} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Onboarding" value={d.counts.onboarding} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Pending leave requests" value={d.pendingRequests.length} valueStyle={{ color: d.pendingRequests.length ? '#d48806' : undefined }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Pay rises overdue" value={d.payRiseDue.length} valueStyle={{ color: d.payRiseDue.length ? '#cf1322' : undefined }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="Pay runs"
            extra={
              <Button size="small" type="primary" onClick={() => navigate('/pay-runs')}>
                Open
              </Button>
            }
          >
            <List size="small">
              <List.Item>
                Next pay date <b style={{ margin: '0 6px' }}>{date(pr.suggestedNextPayDate)}</b>
                {pr.hasRunForSuggested ? <Tag color="green">run exists</Tag> : <Tag color="gold">no run yet</Tag>}
              </List.Item>
              {pr.drafts.map((r) => (
                <List.Item key={r.run.id}>
                  <Link to={`/pay-runs/${r.run.id}`}>Draft for {date(r.run.payDate)}</Link>
                  <span className="muted" style={{ marginLeft: 8 }}>
                    {r.totals.included} people · {money(r.totals.exportAmount, r.run.sourceCurrency)}
                  </span>
                </List.Item>
              ))}
              {pr.last && (
                <List.Item>
                  <Link to={`/pay-runs/${pr.last.run.id}`}>Last run {date(pr.last.run.payDate)}</Link>
                  <Tag color={RUN_STATUS_COLOR[pr.last.run.status]} style={{ marginLeft: 8 }}>
                    {RUN_STATUS_LABELS[pr.last.run.status]}
                  </Tag>
                  <span className="muted">{money(pr.last.totals.exportAmount, pr.last.run.sourceCurrency)}</span>
                </List.Item>
              )}
            </List>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Section
            title="Leave in the next 30 days"
            items={d.upcomingLeave}
            empty="Nobody off"
            extra={<Link to="/leave">Calendar</Link>}
            render={(r) => (
              <span>
                <Link to={`/team/${r.memberId}`}>{r.memberName}</Link> · {LEAVE_TYPE_LABELS[r.type]} · {date(r.startDate)}
                {r.endDate !== r.startDate ? ` – ${date(r.endDate)}` : ''} ({r.days}d){r.status === 'requested' && <Tag color="gold" style={{ marginLeft: 8 }}>requested</Tag>}
              </span>
            )}
          />
        </Col>
        <Col xs={24} lg={12}>
          <Section
            title="Pending leave requests"
            items={d.pendingRequests}
            empty="Nothing to approve"
            render={(r) => (
              <span>
                <Link to={`/team/${r.memberId}`}>{r.memberName}</Link> · {date(r.startDate)}
                {r.endDate !== r.startDate ? ` – ${date(r.endDate)}` : ''} ({r.days}d)
              </span>
            )}
          />
        </Col>
        <Col xs={24} lg={12}>
          <Section
            title="Anniversaries and birthdays (30 days)"
            items={[
              ...d.anniversaries.map((a) => ({ key: `a${a.memberId}`, memberId: a.memberId, text: `${a.name} · ${a.years} year${a.years === 1 ? '' : 's'} on ${date(a.date)}`, daysAway: a.daysAway })),
              ...d.birthdays.map((b) => ({ key: `b${b.memberId}`, memberId: b.memberId, text: `${b.name} · birthday ${date(b.date)}`, daysAway: b.daysAway })),
            ].sort((x, y) => x.daysAway - y.daysAway)}
            empty="None coming up"
            render={(i) => (
              <span>
                <Link to={`/team/${i.memberId}`}>{i.text}</Link> <Tag style={{ marginLeft: 8 }}>{i.daysAway === 0 ? 'today' : `${i.daysAway}d`}</Tag>
              </span>
            )}
          />
        </Col>
        <Col xs={24} lg={12}>
          <Section
            title="Pay rise review due"
            items={d.payRiseDue}
            empty="Everyone reviewed within the threshold"
            render={(p) => (
              <span>
                <Link to={`/team/${p.memberId}`}>{p.name}</Link> · last change {date(p.since)} ({p.monthsSince} mo){p.currentPay && <span className="muted"> · {p.currentPay}</span>}
              </span>
            )}
          />
        </Col>
        <Col xs={24} lg={12}>
          <Section
            title="13th month pay"
            items={d.thirteenthMonth}
            empty="Not due this month or next"
            render={(t) => (
              <span>
                <Link to={`/team/${t.memberId}`}>{t.name}</Link> · {MONTHS[t.payMonth - 1]}
                {t.estimate !== null && <span className="muted"> · about {money(t.estimate, 'USD')}</span>}
                {t.paidThisYear ? <Tag color="green" style={{ marginLeft: 8 }}>in a run</Tag> : <Tag color="gold" style={{ marginLeft: 8 }}>not yet</Tag>}
              </span>
            )}
          />
        </Col>
        <Col xs={24} lg={12}>
          <Section
            title="Onboarding"
            items={d.onboarding}
            empty="Nobody onboarding"
            render={(o) => (
              <span>
                <Link to={`/team/${o.memberId}`}>{o.name}</Link>
                {o.jobTitle && <span className="muted"> · {o.jobTitle}</span>}
                {o.startDate && <span className="muted"> · starts {date(o.startDate)}</span>}
              </span>
            )}
          />
        </Col>
        {d.lowLeave.length > 0 && (
          <Col xs={24} lg={12}>
            <Section
              title="Negative leave balance"
              items={d.lowLeave}
              empty=""
              render={(l) => (
                <span>
                  <Link to={`/team/${l.memberId}`}>{l.name}</Link> <Tag color="red" style={{ marginLeft: 8 }}>{l.available} days</Tag>
                </span>
              )}
            />
          </Col>
        )}
      </Row>
    </div>
  );
}
