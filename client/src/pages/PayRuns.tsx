import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Typography, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeError } from '../api';
import { date, money } from '../format';
import { RUN_STATUS_COLOR, RUN_STATUS_LABELS, type PayFrequency, type RunSummary, type RunView } from '../types';

interface NewRunForm {
  payDate: Dayjs;
  frequency: PayFrequency;
  notes?: string;
}

/** Next Friday on or after today, the usual weekly pay day. */
function nextFriday(): Dayjs {
  const d = dayjs();
  const diff = (5 - d.day() + 7) % 7;
  return d.add(diff, 'day');
}

export function PayRuns() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<NewRunForm>();

  const load = () => {
    setLoading(true);
    api<{ payRuns: RunSummary[] }>('/api/pay-runs')
      .then((r) => setRows(r.payRuns))
      .catch((e) => message.error(describeError(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [message]);

  const create = async (v: NewRunForm) => {
    setCreating(true);
    try {
      const r = await api<RunView>('/api/pay-runs', {
        method: 'POST',
        json: { payDate: v.payDate.format('YYYY-MM-DD'), frequency: v.frequency, notes: v.notes || null },
      });
      setOpen(false);
      navigate(`/pay-runs/${r.run.id}`);
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Pay runs
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          New pay run
        </Button>
      </div>
      <Table<RunSummary>
        rowKey={(r) => r.run.id}
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 26, hideOnSinglePage: true }}
        onRow={(r) => ({ onClick: () => navigate(`/pay-runs/${r.run.id}`), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: 'Pay date',
            key: 'payDate',
            render: (_, r) => (
              <Link to={`/pay-runs/${r.run.id}`} onClick={(e) => e.stopPropagation()}>
                {date(r.run.payDate)}
              </Link>
            ),
          },
          { title: 'Period', key: 'period', render: (_, r) => `${date(r.run.periodStart)} – ${date(r.run.periodEnd)}` },
          { title: 'Frequency', dataIndex: ['run', 'frequency'] },
          { title: 'Status', key: 'status', render: (_, r) => <Tag color={RUN_STATUS_COLOR[r.run.status]}>{RUN_STATUS_LABELS[r.run.status]}</Tag> },
          { title: 'People', key: 'people', render: (_, r) => `${r.totals.included} of ${r.totals.lines}` },
          { title: 'Net to team', key: 'net', align: 'right', render: (_, r) => money(r.totals.netAmount, r.run.sourceCurrency) },
          { title: 'Sent via Wise', key: 'export', align: 'right', render: (_, r) => money(r.totals.exportAmount, r.run.sourceCurrency) },
          { title: 'Notes', dataIndex: ['run', 'notes'], ellipsis: true },
        ]}
      />
      <Modal title="New pay run" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={creating} destroyOnClose>
        <Form<NewRunForm> form={form} layout="vertical" onFinish={create} initialValues={{ payDate: nextFriday(), frequency: 'weekly' }}>
          <Space align="start">
            <Form.Item name="payDate" label="Pay date" rules={[{ required: true }]}>
              <DatePicker />
            </Form.Item>
            <Form.Item name="frequency" label="Includes people paid">
              <Select
                style={{ width: 160 }}
                options={[
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'fortnightly', label: 'Fortnightly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="Notes">
            <Input />
          </Form.Item>
          <Typography.Paragraph className="muted" style={{ marginBottom: 0 }}>
            Everyone active with a Wise pay schedule on this frequency is added with their current pay. You can adjust lines before exporting.
          </Typography.Paragraph>
        </Form>
      </Modal>
    </div>
  );
}
