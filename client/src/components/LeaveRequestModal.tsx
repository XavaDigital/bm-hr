import { useEffect, useState } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, Select, Space, App as AntApp } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { api, describeError } from '../api';
import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, type LeaveRequest, type LeaveStatus, type LeaveType } from '../types';

interface FormShape {
  memberId: string;
  type: LeaveType;
  range: [Dayjs, Dayjs];
  days?: number;
  status: LeaveStatus;
  notes?: string;
}

/** Mon–Fri count, same rule as the server default. */
export function workingDays(start: Dayjs, end: Dayjs): number {
  let n = 0;
  for (let d = start.startOf('day'); !d.isAfter(end, 'day'); d = d.add(1, 'day')) {
    if (d.day() !== 0 && d.day() !== 6) n++;
  }
  return n;
}

export function LeaveRequestModal({
  open,
  onClose,
  onSaved,
  members,
  existing,
  defaultMemberId,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  members: { id: string; name: string }[];
  existing?: LeaveRequest | null;
  defaultMemberId?: string;
  defaultDate?: string;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormShape>();
  const [saving, setSaving] = useState(false);
  const range = Form.useWatch('range', form);
  const autoDays = range?.[0] && range?.[1] ? workingDays(range[0], range[1]) : 0;

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      existing
        ? { memberId: existing.memberId, type: existing.type, range: [dayjs(existing.startDate), dayjs(existing.endDate)], days: existing.days, status: existing.status, notes: existing.notes ?? '' }
        : { memberId: defaultMemberId, type: 'annual', range: defaultDate ? [dayjs(defaultDate), dayjs(defaultDate)] : undefined, days: undefined, status: 'approved', notes: '' },
    );
  }, [open, existing, defaultMemberId, defaultDate, form]);

  const submit = async (v: FormShape) => {
    setSaving(true);
    try {
      const body = {
        memberId: v.memberId,
        type: v.type,
        startDate: v.range[0].format('YYYY-MM-DD'),
        endDate: v.range[1].format('YYYY-MM-DD'),
        ...(v.days !== undefined && v.days !== null ? { days: v.days } : {}),
        status: v.status,
        notes: v.notes?.trim() || null,
      };
      if (existing) await api(`/api/leave/requests/${existing.id}`, { method: 'PATCH', json: body });
      else await api('/api/leave/requests', { method: 'POST', json: body });
      message.success(existing ? 'Leave updated' : 'Leave recorded');
      onClose();
      await onSaved();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={existing ? 'Edit leave' : 'Record leave'} open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} destroyOnClose={false}>
      <Form<FormShape> form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="memberId" label="Who" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" disabled={!!existing} options={members.map((m) => ({ value: m.id, label: m.name }))} />
        </Form.Item>
        <Space align="start">
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select style={{ width: 160 }} options={(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))} />
          </Form.Item>
          <Form.Item name="status" label="Status" rules={[{ required: true }]}>
            <Select style={{ width: 140 }} options={(Object.keys(LEAVE_STATUS_LABELS) as LeaveStatus[]).map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] }))} />
          </Form.Item>
        </Space>
        <Space align="start">
          <Form.Item name="range" label="Dates" rules={[{ required: true }]}>
            <DatePicker.RangePicker />
          </Form.Item>
          <Form.Item name="days" label="Days" tooltip="Leave blank to use the Mon–Fri count. Half days allowed.">
            <InputNumber min={0} step={0.5} placeholder={autoDays ? String(autoDays) : ''} style={{ width: 100 }} />
          </Form.Item>
        </Space>
        <Form.Item name="notes" label="Notes">
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
