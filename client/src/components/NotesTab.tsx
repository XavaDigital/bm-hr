import { useCallback, useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, Popconfirm, Select, Space, Spin, Tag, Timeline, Typography, App as AntApp } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { api, describeError } from '../api';
import { date, money } from '../format';
import { EVENT_TYPE_COLOR, EVENT_TYPE_LABELS, PERIOD_LABELS, type Compensation, type EventType, type MemberEvent } from '../types';

interface FormShape {
  date: Dayjs;
  type: EventType;
  text: string;
}

type Item = { key: string; date: string; color: string; label: React.ReactNode; body: React.ReactNode; event?: MemberEvent };

export function NotesTab({ memberId, compensation }: { memberId: string; compensation: Compensation[] }) {
  const { message } = AntApp.useApp();
  const [events, setEvents] = useState<MemberEvent[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormShape>();

  const load = useCallback(async () => {
    try {
      setEvents((await api<{ events: MemberEvent[] }>(`/api/members/${memberId}/events`)).events);
    } catch (e) {
      message.error(describeError(e));
    }
  }, [memberId, message]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!events) return <Spin />;

  const submit = async (v: FormShape) => {
    setSaving(true);
    try {
      await api(`/api/members/${memberId}/events`, { method: 'POST', json: { date: v.date.format('YYYY-MM-DD'), type: v.type, text: v.text } });
      form.resetFields(['text']);
      await load();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: MemberEvent) => {
    try {
      await api(`/api/members/${memberId}/events/${e.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      message.error(describeError(err));
    }
  };

  const items: Item[] = [
    ...events.map((e) => ({
      key: `e${e.id}`,
      date: e.date,
      color: { note: 'gray', review: 'blue', warning: 'red', milestone: 'green', other: 'gray' }[e.type],
      label: <Tag color={EVENT_TYPE_COLOR[e.type]}>{EVENT_TYPE_LABELS[e.type]}</Tag>,
      body: (
        <div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {e.createdByEmail ?? ''}
          </div>
        </div>
      ),
      event: e,
    })),
    ...compensation.map((c) => ({
      key: `c${c.id}`,
      date: c.effectiveFrom,
      color: 'gold',
      label: <Tag color="gold">Pay</Tag>,
      body: (
        <span>
          {c.reason === 'initial' ? 'Starting pay' : c.reason === 'pay_rise' ? 'Pay rise' : 'Pay adjustment'}: {money(c.amount, c.currency)} / {PERIOD_LABELS[c.period]}
          {c.notes ? <span className="muted"> · {c.notes}</span> : null}
        </span>
      ),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div style={{ maxWidth: 800 }}>
      <Form<FormShape> form={form} layout="inline" onFinish={submit} initialValues={{ date: dayjs(), type: 'note' }} style={{ marginBottom: 20, gap: 8 }}>
        <Form.Item name="date" rules={[{ required: true }]}>
          <DatePicker />
        </Form.Item>
        <Form.Item name="type">
          <Select style={{ width: 130 }} options={(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => ({ value: t, label: EVENT_TYPE_LABELS[t] }))} />
        </Form.Item>
        <Form.Item name="text" rules={[{ required: true, message: 'Write something' }]} style={{ flex: 1, minWidth: 260 }}>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 6 }} placeholder="Add a note, review outcome, warning or milestone…" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            Add
          </Button>
        </Form.Item>
      </Form>
      {items.length === 0 ? (
        <Typography.Text className="muted">Nothing recorded yet.</Typography.Text>
      ) : (
        <Timeline
          mode="left"
          items={items.map((i) => ({
            key: i.key,
            color: i.color,
            label: <span className="muted">{date(i.date)}</span>,
            children: (
              <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space align="start">
                  {i.label}
                  <div>{i.body}</div>
                </Space>
                {i.event && (
                  <Popconfirm title="Delete this note?" onConfirm={() => remove(i.event!)}>
                    <Button type="link" size="small" danger>
                      Delete
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          }))}
        />
      )}
    </div>
  );
}
