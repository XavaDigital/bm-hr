import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, App as AntApp } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { api, describeError } from '../api';
import type { ChecklistKind, ChecklistTemplate, ChecklistTemplateItem } from '../types';

interface FormShape {
  name: string;
  kind: ChecklistKind;
  isDefault: boolean;
  items: ChecklistTemplateItem[];
}

export function TemplatesCard() {
  const { message } = AntApp.useApp();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [editing, setEditing] = useState<ChecklistTemplate | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormShape>();

  const load = useCallback(async () => {
    try {
      setTemplates((await api<{ templates: ChecklistTemplate[] }>('/api/checklists/templates')).templates);
    } catch (e) {
      message.error(describeError(e));
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (t: ChecklistTemplate | 'new') => {
    setEditing(t);
    form.setFieldsValue(t === 'new' ? { name: '', kind: 'onboarding', isDefault: false, items: [{ title: '', dueDays: 0 }] } : { name: t.name, kind: t.kind, isDefault: t.isDefault, items: t.items });
  };

  const save = async (v: FormShape) => {
    setSaving(true);
    try {
      const body = { ...v, items: v.items.filter((i) => i.title?.trim()).map((i) => ({ title: i.title.trim(), dueDays: i.dueDays ?? null })) };
      if (editing === 'new') await api('/api/checklists/templates', { method: 'POST', json: body });
      else if (editing) await api(`/api/checklists/templates/${editing.id}`, { method: 'PATCH', json: body });
      setEditing(null);
      await load();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Onboarding and offboarding checklists"
      style={{ marginBottom: 16 }}
      extra={
        <Space>
          {templates.length === 0 && (
            <Button size="small" onClick={() => api('/api/checklists/templates/seed-defaults', { method: 'POST' }).then(load).catch((e) => message.error(describeError(e)))}>
              Create starter templates
            </Button>
          )}
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            New template
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph className="muted" style={{ fontSize: 12 }}>
        Applied from a person's Onboarding tab. Due dates are counted from the start date (onboarding) or end date (offboarding).
      </Typography.Paragraph>
      <Table<ChecklistTemplate>
        rowKey="id"
        size="small"
        dataSource={templates}
        pagination={false}
        columns={[
          { title: 'Name', dataIndex: 'name', render: (n: string, t) => <a onClick={() => open(t)}>{n}</a> },
          { title: 'Kind', dataIndex: 'kind', render: (k: ChecklistKind) => <Tag>{k}</Tag> },
          { title: 'Tasks', key: 'n', render: (_, t) => t.items.length },
          { title: 'Default', dataIndex: 'isDefault', render: (d: boolean) => (d ? <Tag color="green">default</Tag> : null) },
          {
            key: 'a',
            width: 60,
            render: (_, t) => (
              <Popconfirm title="Delete template?" onConfirm={() => api(`/api/checklists/templates/${t.id}`, { method: 'DELETE' }).then(load).catch((e) => message.error(describeError(e)))}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />
      <Modal title={editing === 'new' ? 'New template' : 'Edit template'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={saving} width={640}>
        <Form<FormShape> form={form} layout="vertical" onFinish={save}>
          <Space align="start">
            <Form.Item name="name" label="Name" rules={[{ required: true }]}>
              <Input style={{ width: 260 }} />
            </Form.Item>
            <Form.Item name="kind" label="Kind">
              <Select style={{ width: 140 }} options={[{ value: 'onboarding', label: 'Onboarding' }, { value: 'offboarding', label: 'Offboarding' }]} />
            </Form.Item>
            <Form.Item name="isDefault" label="Default" valuePropName="checked">
              <Checkbox />
            </Form.Item>
          </Space>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div>
                {fields.map((f) => (
                  <Space key={f.key} align="start" style={{ display: 'flex', marginBottom: 4 }}>
                    <Form.Item name={[f.name, 'title']} style={{ marginBottom: 0 }} rules={[{ required: true, message: 'Title' }]}>
                      <Input placeholder="Task" style={{ width: 380 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'dueDays']} style={{ marginBottom: 0 }}>
                      <InputNumber placeholder="+days" style={{ width: 90 }} />
                    </Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ title: '', dueDays: null })} style={{ marginTop: 4 }}>
                  Add task
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
    </Card>
  );
}
