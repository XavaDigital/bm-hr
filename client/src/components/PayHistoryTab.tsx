import { useEffect, useState } from 'react';
import { Table, Tag, App as AntApp } from 'antd';
import { Link } from 'react-router-dom';
import { api, describeError } from '../api';
import { date, money } from '../format';
import { RUN_STATUS_COLOR, RUN_STATUS_LABELS, type PayHistoryEntry } from '../types';

export function PayHistoryTab({ memberId }: { memberId: string }) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<PayHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ history: PayHistoryEntry[] }>(`/api/members/${memberId}/pay-history`)
      .then((r) => setRows(r.history))
      .catch((e) => message.error(describeError(e)))
      .finally(() => setLoading(false));
  }, [memberId, message]);

  return (
    <Table<PayHistoryEntry>
      rowKey="runId"
      loading={loading}
      dataSource={rows}
      size="small"
      pagination={{ pageSize: 26, hideOnSinglePage: true }}
      columns={[
        { title: 'Pay date', key: 'd', render: (_, r) => <Link to={`/pay-runs/${r.runId}`}>{date(r.payDate)}</Link> },
        { title: 'Period', key: 'p', render: (_, r) => `${date(r.periodStart)} – ${date(r.periodEnd)}` },
        { title: 'Status', key: 's', render: (_, r) => <Tag color={RUN_STATUS_COLOR[r.status]}>{RUN_STATUS_LABELS[r.status]}</Tag> },
        { title: 'Base', key: 'b', align: 'right', render: (_, r) => money(r.baseAmount, 'USD') },
        { title: '13th', key: 't', align: 'right', render: (_, r) => (r.thirteenthMonthAmount ? money(r.thirteenthMonthAmount, 'USD') : '—') },
        {
          title: 'Adjustment',
          key: 'a',
          render: (_, r) => (r.adjustmentsAmount ? `${money(r.adjustmentsAmount, 'USD')}${r.adjustmentsNote ? ` · ${r.adjustmentsNote}` : ''}` : '—'),
        },
        { title: 'Net', key: 'n', align: 'right', render: (_, r) => <b>{money(r.netAmount, 'USD')}</b> },
        { title: 'Sent', key: 'e', align: 'right', render: (_, r) => money(r.exportAmount, r.exportCurrency) },
        { title: 'Reference', dataIndex: 'paymentReference' },
      ]}
    />
  );
}
