import { useState } from 'react';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, App as AntApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api, describeError } from '../api';
import { date, money } from '../format';
import { PERIOD_LABELS, type Compensation, type CompensationReason, type PayPeriod } from '../types';

const REASON_LABEL: Record<CompensationReason, string> = { initial: 'Starting pay', pay_rise: 'Pay rise', adjustment: 'Adjustment' };
const REASON_COLOR: Record<CompensationReason, string> = { initial: 'default', pay_rise: 'green', adjustment: 'orange' };

interface FormShape {
  amount: number;
  currency: string;
  period: PayPeriod;
  effectiveFrom: Dayjs;
  reason: CompensationReason;
  notes?: string;
}

export function CompensationTab({ memberId, rows, onChange }: { memberId: string; rows: Compensation[]; onChange: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormShape>();
  const latest = rows[0];

  const submit = async (v: FormShape) => {
    setSaving(true);
    try {
      await api(`/api/members/${memberId}/compensation`, {
        method: 'POST',
        json: { ...v, effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'), notes: v.notes || null },
      });
      message.success('Compensation recorded');
      setOpen(false);
      form.resetFields();
      await onChange();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Compensation) => {
    try {
      await api(`/api/members/${memberId}/compensation/${c.id}`, { method: 'DELETE' });
      await onChange();
    } catch (e) {
      message.error(describeError(e));
    }
  };

  const today = dayjs().format('YYYY-MM-DD');

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          {rows.length === 0 ? 'Set starting pay' : 'Record pay rise'}
        </Button>
      </Space>
      <Table<Compensation>
        rowKey="id"
        dataSource={rows}
        pagination={false}
        size="small"
        columns={[
          { title: 'Effective from', dataIndex: 'effectiveFrom', render: (d: string) => (d > today ? <span>{date(d)} <Tag color="blue">upcoming</Tag></span> : date(d)) },
          { title: 'Amount', key: 'amount', render: (_, c) => `${money(c.amount, c.currency)} / ${PERIOD_LABELS[c.period]}` },
          { title: 'Change', key: 'delta', render: (_, c, i) => {
            const prev = rows[i + 1];
            if (!prev || prev.currency !== c.currency || prev.period !== c.period) return '—';
            const pct = ((c.amount - prev.amount) / prev.amount) * 100;
            return <span style={{ color: pct >= 0 ? '#389e0d' : '#cf1322' }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
          } },
          { title: 'Reason', dataIndex: 'reason', render: (r: CompensationReason) => <Tag color={REASON_COLOR[r]}>{REASON_LABEL[r]}</Tag> },
          { title: 'Notes', dataIndex: 'notes', ellipsis: true },
          { title: 'Recorded by', dataIndex: 'createdByEmail', render: (e: string | null) => <span className="muted">{e ?? '—'}</span> },
          {
            key: 'actions',
            width: 80,
            render: (_, c) => (
              <Popconfirm title="Delete this entry?" onConfirm={() => remove(c)}>
                <Button type="link" danger size="small">
                  Delete
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
      <Modal title={rows.length === 0 ? 'Set starting pay' : 'Record pay rise'} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={saving} destroyOnClose>
        <Form<FormShape>
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{
            currency: latest?.currency ?? 'USD',
            period: latest?.period ?? 'weekly',
            reason: rows.length === 0 ? 'initial' : 'pay_rise',
            effectiveFrom: dayjs(),
          }}
        >
          <Space align="start">
            <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
              <InputNumber min={0.01} step={1} precision={2} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="currency" label="Currency" rules={[{ required: true, len: 3 }]}>
              <Input style={{ width: 90 }} maxLength={3} />
            </Form.Item>
            <Form.Item name="period" label="Per" rules={[{ required: true }]}>
              <Select style={{ width: 140 }} options={(Object.keys(PERIOD_LABELS) as PayPeriod[]).map((p) => ({ value: p, label: p }))} />
            </Form.Item>
          </Space>
          <Space align="start">
            <Form.Item name="effectiveFrom" label="Effective from" rules={[{ required: true }]}>
              <DatePicker />
            </Form.Item>
            <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
              <Select style={{ width: 160 }} options={(Object.keys(REASON_LABEL) as CompensationReason[]).map((r) => ({ value: r, label: REASON_LABEL[r] }))} />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
