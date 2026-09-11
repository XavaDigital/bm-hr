import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Descriptions, Input, InputNumber, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Typography, App as AntApp } from 'antd';
import { DownloadOutlined, ReloadOutlined, SendOutlined, CheckOutlined, UndoOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../api';
import { date, money } from '../format';
import { RUN_STATUS_COLOR, RUN_STATUS_LABELS, type LineIssue, type MemberSummary, type PayRunLine, type RunView } from '../types';

export function PayRunDetail() {
  const { id } = useParams<{ id: string }>();
  const { message, modal } = AntApp.useApp();
  const navigate = useNavigate();
  const [view, setView] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [addId, setAddId] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      setView(await api<RunView>(`/api/pay-runs/${id}`));
    } catch (e) {
      message.error(describeError(e));
      navigate('/pay-runs');
    }
  }, [id, message, navigate]);

  useEffect(() => {
    void load();
    api<{ members: MemberSummary[] }>('/api/members')
      .then((r) => setMembers(r.members))
      .catch(() => undefined);
  }, [load]);

  if (!view) {
    return (
      <div className="page">
        <Spin />
      </div>
    );
  }
  const { run, lines, totals, issues } = view;
  const draft = run.status === 'draft';
  const cur = run.sourceCurrency;
  const errors = issues.filter((i) => i.level === 'error');
  const issuesByLine = new Map<string, LineIssue[]>();
  for (const i of issues) issuesByLine.set(i.lineId, [...(issuesByLine.get(i.lineId) ?? []), i]);

  const act = async (fn: () => Promise<RunView | void>, ok?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) setView(r);
      if (ok) message.success(ok);
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const patchLine = (line: PayRunLine, patch: Record<string, unknown>) =>
    act(() => api<RunView>(`/api/pay-runs/${run.id}/lines/${line.id}`, { method: 'PATCH', json: patch }));

  const exportRun = () =>
    modal.confirm({
      title: 'Export this pay run?',
      content: `Lines will be frozen and invoice references assigned. ${totals.included} payments totalling ${money(totals.exportAmount, cur)} will be in the file.`,
      okText: 'Export',
      onOk: () =>
        act(async () => {
          const r = await api<RunView>(`/api/pay-runs/${run.id}/export`, { method: 'POST' });
          window.location.assign(`/api/pay-runs/${run.id}/csv`);
          return r;
        }, 'Exported. Upload the CSV in Wise, then mark the run paid.'),
    });

  const inRun = new Set(lines.map((l) => l.memberId));
  const addable = members.filter((m) => !inRun.has(m.member.id) && m.schedule && m.member.status !== 'offboarded');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Pay run {date(run.payDate)} <Tag color={RUN_STATUS_COLOR[run.status]} style={{ marginLeft: 8, verticalAlign: 'middle' }}>{RUN_STATUS_LABELS[run.status]}</Tag>
          </Typography.Title>
          <Typography.Text className="muted">
            {run.frequency} · {date(run.periodStart)} – {date(run.periodEnd)} · {cur}
            {run.notes ? ` · ${run.notes}` : ''}
          </Typography.Text>
        </div>
        <Space wrap>
          {draft && (
            <Tooltip title="Re-pull current pay, fee settings and recipient details; add anyone newly eligible">
              <Button icon={<ReloadOutlined />} loading={busy} onClick={() => act(() => api<RunView>(`/api/pay-runs/${run.id}/refresh`, { method: 'POST' }), 'Refreshed')}>
                Refresh
              </Button>
            </Tooltip>
          )}
          <Button icon={<DownloadOutlined />} href={`/api/pay-runs/${run.id}/csv`}>
            {draft ? 'Preview CSV' : 'Download CSV'}
          </Button>
          {draft && (
            <Button type="primary" icon={<SendOutlined />} disabled={errors.length > 0 || totals.included === 0} loading={busy} onClick={exportRun}>
              Export for Wise
            </Button>
          )}
          {run.status === 'exported' && (
            <>
              <Button icon={<UndoOutlined />} loading={busy} onClick={() => act(() => api<RunView>(`/api/pay-runs/${run.id}/reopen`, { method: 'POST' }), 'Reopened as draft')}>
                Reopen
              </Button>
              <Popconfirm title="Mark this run as paid?" description="Do this after the Wise batch has been funded and sent." onConfirm={() => act(() => api<RunView>(`/api/pay-runs/${run.id}/mark-paid`, { method: 'POST' }), 'Marked paid')}>
                <Button type="primary" icon={<CheckOutlined />} loading={busy}>
                  Mark paid
                </Button>
              </Popconfirm>
            </>
          )}
          {draft && (
            <Popconfirm title="Delete this draft?" onConfirm={() => act(async () => { await api(`/api/pay-runs/${run.id}`, { method: 'DELETE' }); navigate('/pay-runs'); })}>
              <Button danger icon={<DeleteOutlined />}>
                Delete
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <Descriptions size="small" column={{ xs: 1, md: 4 }} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="People">{totals.included} of {totals.lines}</Descriptions.Item>
        <Descriptions.Item label="Net to team">{money(totals.netAmount, cur)}</Descriptions.Item>
        <Descriptions.Item label="Wise fees covered">{money(totals.grossUpAmount, cur)}</Descriptions.Item>
        <Descriptions.Item label="Total sent">{money(totals.exportAmount, cur)}</Descriptions.Item>
      </Descriptions>

      {errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${errors.length} problem${errors.length > 1 ? 's' : ''} block export`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((i, n) => (
                <li key={n}>
                  <b>{i.memberName}</b>: {i.message}
                </li>
              ))}
            </ul>
          }
        />
      )}
      {run.status === 'exported' && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Exported and frozen. Upload the CSV in Wise (Batch payments → Send to saved recipients), review, fund, then mark this run paid." />
      )}

      <Table<PayRunLine>
        rowKey="id"
        dataSource={lines}
        pagination={false}
        size="small"
        scroll={{ x: 1100 }}
        rowClassName={(l) => (l.included ? '' : 'muted')}
        columns={[
          {
            title: '',
            key: 'inc',
            width: 40,
            render: (_, l) => <Checkbox checked={l.included} disabled={!draft || busy} onChange={(e) => patchLine(l, { included: e.target.checked })} />,
          },
          {
            title: 'Person',
            key: 'name',
            render: (_, l) => (
              <div>
                <Link to={`/team/${l.memberId}`}>{l.memberName}</Link>
                <div className="muted" style={{ fontSize: 12 }}>
                  {l.recipientKind === 'gcash' ? 'GCash' : l.recipientKind === 'wise_account' ? 'Wise account' : 'kind not set'}
                  {l.recipientDetail ? ` · ${l.recipientDetail}` : ''}
                </div>
                {(issuesByLine.get(l.id) ?? []).map((i, n) => (
                  <div key={n} style={{ fontSize: 12, color: i.level === 'error' ? '#cf1322' : '#d48806' }}>
                    {i.message}
                  </div>
                ))}
              </div>
            ),
          },
          { title: 'Base', key: 'base', align: 'right', render: (_, l) => money(l.baseAmount, cur) },
          {
            title: '13th month',
            key: '13',
            align: 'right',
            width: 130,
            render: (_, l) =>
              draft ? (
                <InputNumber size="small" min={0} precision={2} value={l.thirteenthMonthAmount} disabled={busy} style={{ width: 110 }} onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== l.thirteenthMonthAmount) void patchLine(l, { thirteenthMonthAmount: v });
                }} />
              ) : (
                l.thirteenthMonthAmount ? money(l.thirteenthMonthAmount, cur) : '—'
              ),
          },
          {
            title: 'Adjustment',
            key: 'adj',
            width: 300,
            render: (_, l) =>
              draft ? (
                <Space.Compact style={{ width: '100%' }}>
                  <InputNumber size="small" precision={2} value={l.adjustmentsAmount} disabled={busy} style={{ width: 110 }} onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v !== l.adjustmentsAmount) void patchLine(l, { adjustmentsAmount: v });
                  }} />
                  <Input size="small" placeholder="reason (unpaid leave, bonus…)" defaultValue={l.adjustmentsNote ?? ''} disabled={busy} onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (l.adjustmentsNote ?? null)) void patchLine(l, { adjustmentsNote: v });
                  }} />
                </Space.Compact>
              ) : (
                <span>
                  {l.adjustmentsAmount ? money(l.adjustmentsAmount, cur) : '—'}
                  {l.adjustmentsNote && <span className="muted"> · {l.adjustmentsNote}</span>}
                </span>
              ),
          },
          { title: 'Net', key: 'net', align: 'right', render: (_, l) => <b>{money(l.netAmount, cur)}</b> },
          {
            title: 'Sent',
            key: 'sent',
            align: 'right',
            render: (_, l) => (
              <Tooltip title={l.amountMode === 'source' ? `source mode: net + fee (${money(l.feeFixed, cur)} + ${(l.feePct * 100).toFixed(2)}%) = ${money(l.grossUpAmount, cur)} gross-up` : 'target mode: recipient gets exactly this'}>
                <span>
                  {money(l.exportAmount, l.exportCurrency)}
                  <span className="muted" style={{ fontSize: 12 }}> {l.amountMode}</span>
                </span>
              </Tooltip>
            ),
          },
          {
            title: 'Reference',
            key: 'ref',
            width: 150,
            render: (_, l) =>
              draft ? (
                <Input size="small" defaultValue={l.paymentReference ?? ''} disabled={busy} placeholder="auto" onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (l.paymentReference ?? null)) void patchLine(l, { paymentReference: v });
                }} />
              ) : (
                l.paymentReference ?? '—'
              ),
          },
          ...(draft
            ? [
                {
                  key: 'rm',
                  width: 40,
                  render: (_: unknown, l: PayRunLine) => (
                    <Popconfirm title="Remove from this run?" onConfirm={() => act(() => api<RunView>(`/api/pay-runs/${run.id}/lines/${l.id}`, { method: 'DELETE' }))}>
                      <Button type="link" danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  ),
                },
              ]
            : []),
        ]}
      />

      {draft && addable.length > 0 && (
        <Space style={{ marginTop: 12 }}>
          <Select
            showSearch
            placeholder="Add someone to this run"
            style={{ width: 280 }}
            value={addId}
            onChange={setAddId}
            optionFilterProp="label"
            options={addable.map((m) => ({ value: m.member.id, label: `${m.member.firstName} ${m.member.lastName}` }))}
          />
          <Button icon={<PlusOutlined />} disabled={!addId} loading={busy} onClick={() => act(async () => { const r = await api<RunView>(`/api/pay-runs/${run.id}/lines`, { method: 'POST', json: { memberId: addId } }); setAddId(undefined); return r; })}>
            Add
          </Button>
        </Space>
      )}
    </div>
  );
}
