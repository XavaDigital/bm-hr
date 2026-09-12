import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Popconfirm, Segmented, Space, Table, Tag, Tooltip, Typography, App as AntApp } from 'antd';
import { LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import { api, describeError } from '../api';
import { date } from '../format';
import { LeaveRequestModal } from '../components/LeaveRequestModal';
import { LEAVE_STATUS_COLOR, LEAVE_STATUS_LABELS, LEAVE_TYPE_COLOR, LEAVE_TYPE_LABELS, type LeaveRequest, type MemberSummary } from '../types';

const CHIP: Record<string, string> = { annual: '#b7eb8f', sick: '#ffbb96', unpaid: '#d9d9d9', public_holiday: '#d3adf7', other: '#91caff' };

export function Leave() {
  const { message } = AntApp.useApp();
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [modal, setModal] = useState<{ open: boolean; existing?: LeaveRequest | null; date?: string }>({ open: false });
  const [view, setView] = useState<'calendar' | 'list'>('calendar');

  const gridStart = month.startOf('month').startOf('week');
  const gridEnd = month.endOf('month').endOf('week');

  const load = useCallback(async () => {
    try {
      const r = await api<{ requests: LeaveRequest[] }>(`/api/leave/requests?from=${gridStart.format('YYYY-MM-DD')}&to=${gridEnd.format('YYYY-MM-DD')}`);
      setRequests(r.requests);
    } catch (e) {
      message.error(describeError(e));
    }
  }, [gridStart, gridEnd, message]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<{ members: MemberSummary[] }>('/api/members')
      .then((r) => setMembers(r.members.filter((m) => m.member.status !== 'offboarded')))
      .catch(() => undefined);
  }, []);

  const memberOptions = useMemo(() => members.map((m) => ({ id: m.member.id, name: `${m.member.firstName} ${m.member.lastName}` })), [members]);

  const weeks: Dayjs[][] = [];
  for (let d = gridStart; !d.isAfter(gridEnd); d = d.add(7, 'day')) weeks.push(Array.from({ length: 7 }, (_, i) => d.add(i, 'day')));

  const onDay = (d: Dayjs) => requests.filter((r) => r.status !== 'cancelled' && !d.isBefore(dayjs(r.startDate), 'day') && !d.isAfter(dayjs(r.endDate), 'day'));
  const today = dayjs();

  const remove = async (r: LeaveRequest) => {
    try {
      await api(`/api/leave/requests/${r.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      message.error(describeError(e));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <Space>
          <Button icon={<LeftOutlined />} onClick={() => setMonth(month.subtract(1, 'month'))} />
          <Typography.Title level={3} style={{ margin: 0, minWidth: 200, textAlign: 'center' }}>
            {month.format('MMMM YYYY')}
          </Typography.Title>
          <Button icon={<RightOutlined />} onClick={() => setMonth(month.add(1, 'month'))} />
          <Button onClick={() => setMonth(dayjs().startOf('month'))}>Today</Button>
        </Space>
        <Space>
          <Segmented value={view} onChange={(v) => setView(v as 'calendar' | 'list')} options={[{ label: 'Calendar', value: 'calendar' }, { label: 'List', value: 'list' }]} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ open: true })}>
            Record leave
          </Button>
        </Space>
      </div>

      {view === 'calendar' ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 840 }}>
            <thead>
              <tr>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <th key={d} style={{ textAlign: 'left', padding: 6, fontWeight: 500 }} className="muted">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={i}>
                  {w.map((d) => {
                    const inMonth = d.isSame(month, 'month');
                    const weekend = d.day() === 0 || d.day() === 6;
                    return (
                      <td
                        key={d.toString()}
                        onClick={() => setModal({ open: true, date: d.format('YYYY-MM-DD') })}
                        style={{
                          verticalAlign: 'top',
                          height: 96,
                          padding: 4,
                          border: '1px solid #f0f0f0',
                          background: weekend ? '#fafafa' : '#fff',
                          opacity: inMonth ? 1 : 0.45,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: d.isSame(today, 'day') ? 700 : 400, color: d.isSame(today, 'day') ? '#1677ff' : undefined }}>{d.date()}</div>
                        {onDay(d).map((r) => (
                          <Tooltip key={r.id} title={`${r.memberName}: ${LEAVE_TYPE_LABELS[r.type]} ${date(r.startDate)} – ${date(r.endDate)} (${r.days}d, ${LEAVE_STATUS_LABELS[r.status]})`}>
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setModal({ open: true, existing: r });
                              }}
                              style={{
                                fontSize: 11,
                                marginTop: 2,
                                padding: '1px 4px',
                                borderRadius: 3,
                                background: CHIP[r.type],
                                border: r.status === 'requested' ? '1px dashed #d48806' : 'none',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {r.memberName}
                            </div>
                          </Tooltip>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <Typography.Text className="muted" style={{ fontSize: 12 }}>
            Click a day to record leave; click a chip to edit. Dashed border = requested, not yet approved.
          </Typography.Text>
        </div>
      ) : (
        <Table<LeaveRequest>
          rowKey="id"
          size="small"
          dataSource={requests}
          pagination={false}
          columns={[
            { title: 'Who', key: 'who', render: (_, r) => <Link to={`/team/${r.memberId}`}>{r.memberName}</Link> },
            { title: 'Type', dataIndex: 'type', render: (t: LeaveRequest['type']) => <Tag color={LEAVE_TYPE_COLOR[t]}>{LEAVE_TYPE_LABELS[t]}</Tag> },
            { title: 'From', dataIndex: 'startDate', render: (d: string) => date(d) },
            { title: 'To', dataIndex: 'endDate', render: (d: string) => date(d) },
            { title: 'Days', dataIndex: 'days', align: 'right' },
            { title: 'Status', dataIndex: 'status', render: (s: LeaveRequest['status']) => <Tag color={LEAVE_STATUS_COLOR[s]}>{LEAVE_STATUS_LABELS[s]}</Tag> },
            { title: 'Notes', dataIndex: 'notes', ellipsis: true },
            {
              key: 'a',
              width: 120,
              render: (_, r) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => setModal({ open: true, existing: r })}>
                    Edit
                  </Button>
                  <Popconfirm title="Delete this leave?" onConfirm={() => remove(r)}>
                    <Button type="link" size="small" danger>
                      Delete
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}

      <LeaveRequestModal open={modal.open} existing={modal.existing} defaultDate={modal.date} members={memberOptions} onClose={() => setModal({ open: false })} onSaved={load} />
    </div>
  );
}
