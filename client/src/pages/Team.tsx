import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Segmented, Space, Table, Tag, Typography, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeError } from '../api';
import { date, fullName, pay, sinceRelative, tenure } from '../format';
import { STATUS_LABELS, type MemberStatus, type MemberSummary } from '../types';

const STATUS_COLOR: Record<MemberStatus, string> = { onboarding: 'blue', active: 'green', offboarded: 'default' };

type Filter = 'current' | 'all' | MemberStatus;

export function Team() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('current');
  const [q, setQ] = useState('');

  useEffect(() => {
    setLoading(true);
    api<{ members: MemberSummary[] }>('/api/members')
      .then((r) => setRows(r.members))
      .catch((e) => message.error(describeError(e)))
      .finally(() => setLoading(false));
  }, [message]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const s = r.member.status;
      if (filter === 'current' && s === 'offboarded') return false;
      if (filter !== 'current' && filter !== 'all' && s !== filter) return false;
      if (!needle) return true;
      const hay = [r.member.firstName, r.member.lastName, r.member.preferredName, r.member.email, r.member.jobTitle, r.member.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, filter, q]);

  return (
    <div className="page">
      <div className="page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Team
        </Typography.Title>
        <Space wrap>
          <Input.Search placeholder="Search" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { label: 'Current', value: 'current' },
              { label: 'Onboarding', value: 'onboarding' },
              { label: 'Active', value: 'active' },
              { label: 'Offboarded', value: 'offboarded' },
              { label: 'All', value: 'all' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/team/new')}>
            Add member
          </Button>
        </Space>
      </div>
      <Table<MemberSummary>
        rowKey={(r) => r.member.id}
        loading={loading}
        dataSource={visible}
        pagination={false}
        size="middle"
        scroll={{ x: 900 }}
        onRow={(r) => ({ onClick: () => navigate(`/team/${r.member.id}`), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: 'Name',
            key: 'name',
            render: (_, r) => (
              <div>
                <Link to={`/team/${r.member.id}`} onClick={(e) => e.stopPropagation()}>
                  {fullName(r.member)}
                </Link>
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.member.jobTitle ?? ''}
                  {r.member.jobTitle && r.member.country ? ' · ' : ''}
                  {r.member.country ?? ''}
                </div>
              </div>
            ),
            sorter: (a, b) => a.member.firstName.localeCompare(b.member.firstName),
          },
          {
            title: 'Status',
            key: 'status',
            width: 120,
            render: (_, r) => <Tag color={STATUS_COLOR[r.member.status]}>{STATUS_LABELS[r.member.status]}</Tag>,
          },
          {
            title: 'Pay',
            key: 'pay',
            render: (_, r) => pay(r.currentPay),
            sorter: (a, b) => (a.currentPay?.amount ?? 0) - (b.currentPay?.amount ?? 0),
          },
          {
            title: 'Last pay rise',
            key: 'rise',
            render: (_, r) => (r.lastPayRise ? `${date(r.lastPayRise.effectiveFrom)} (${sinceRelative(r.lastPayRise.effectiveFrom)})` : '—'),
            sorter: (a, b) => (a.lastPayRise?.effectiveFrom ?? '').localeCompare(b.lastPayRise?.effectiveFrom ?? ''),
          },
          {
            title: 'Started',
            key: 'start',
            render: (_, r) => (
              <span>
                {date(r.member.startDate)}
                {r.tenureMonths !== null && <span className="muted"> · {tenure(r.tenureMonths)}</span>}
              </span>
            ),
            sorter: (a, b) => (a.member.startDate ?? '').localeCompare(b.member.startDate ?? ''),
          },
          {
            title: 'Anniversary',
            key: 'anniv',
            render: (_, r) =>
              r.nextAnniversary ? (
                <span>
                  {date(r.nextAnniversary)}
                  {r.daysToAnniversary !== null && r.daysToAnniversary <= 30 && <Tag color="gold" style={{ marginLeft: 8 }}>{r.daysToAnniversary}d</Tag>}
                </span>
              ) : (
                '—'
              ),
            sorter: (a, b) => (a.daysToAnniversary ?? 9999) - (b.daysToAnniversary ?? 9999),
          },
          {
            title: 'Payout',
            key: 'payout',
            render: (_, r) => {
              const s = r.schedule;
              if (!s) return <span className="muted">not set</span>;
              const method = s.payoutMethod === 'wise' ? `Wise${s.wiseRecipientKind ? ` (${s.wiseRecipientKind === 'gcash' ? 'GCash' : 'Wise account'})` : ''}` : s.payoutMethod === 'xero_bank' ? 'Bank via Xero' : 'Other';
              return (
                <span>
                  {method}
                  <span className="muted"> · {s.frequency}</span>
                  {s.thirteenthMonth && <Tag style={{ marginLeft: 8 }}>13th</Tag>}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
}
