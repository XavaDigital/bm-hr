import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Checkbox, Col, DatePicker, Empty, Input, Popconfirm, Progress, Row, Select, Space, Spin, Tag, Typography, App as AntApp } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api, describeError } from '../api';
import { date } from '../format';
import type { ChecklistKind, ChecklistTask, ChecklistTemplate, MemberChecklist, TeamMember } from '../types';

function KindSection({
  kind,
  member,
  data,
  templates,
  onChange,
}: {
  kind: ChecklistKind;
  member: TeamMember;
  data: MemberChecklist;
  templates: ChecklistTemplate[];
  onChange: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState<string | undefined>(templates.find((t) => t.kind === kind && t.isDefault)?.id);
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState<Dayjs | null>(null);
  const tasks = data.tasks.filter((t) => t.kind === kind);
  const progress = data[kind];
  const today = dayjs().format('YYYY-MM-DD');
  const kindTemplates = templates.filter((t) => t.kind === kind);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChange();
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const anchor = kind === 'onboarding' ? member.startDate : member.endDate;

  return (
    <Card
      size="small"
      title={
        <Space>
          <span>{kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}</span>
          {progress.total > 0 && (
            <Progress percent={Math.round((progress.done / progress.total) * 100)} size="small" style={{ width: 140, margin: 0 }} format={() => `${progress.done}/${progress.total}`} />
          )}
          {progress.overdue > 0 && <Tag color="red">{progress.overdue} overdue</Tag>}
        </Space>
      }
      style={{ marginBottom: 16 }}
      extra={
        kindTemplates.length > 0 && (
          <Space>
            <Select size="small" style={{ width: 200 }} value={templateId} onChange={setTemplateId} options={kindTemplates.map((t) => ({ value: t.id, label: t.name }))} placeholder="Template" />
            <Button size="small" disabled={!templateId} loading={busy} onClick={() => act(() => api(`/api/members/${member.id}/checklist/apply`, { method: 'POST', json: { templateId } }))}>
              Apply template
            </Button>
          </Space>
        )
      }
    >
      {!anchor && kindTemplates.length > 0 && (
        <Typography.Paragraph className="muted" style={{ fontSize: 12 }}>
          No {kind === 'onboarding' ? 'start' : 'end'} date on the profile, so template tasks will have no due dates.
        </Typography.Paragraph>
      )}
      {tasks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={kindTemplates.length ? 'No tasks yet. Apply a template or add one below.' : 'No tasks yet. Create templates in Settings, or add one below.'} />
      ) : (
        tasks.map((t: ChecklistTask) => {
          const overdue = !t.doneAt && t.dueDate && t.dueDate < today;
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #f5f5f5' }}>
              <Checkbox checked={!!t.doneAt} disabled={busy} onChange={(e) => act(() => api(`/api/members/${member.id}/checklist/${t.id}`, { method: 'PATCH', json: { done: e.target.checked } }))} />
              <span style={{ flex: 1, textDecoration: t.doneAt ? 'line-through' : undefined, color: t.doneAt ? 'rgba(0,0,0,0.45)' : undefined }}>{t.title}</span>
              {t.dueDate && (
                <Tag color={overdue ? 'red' : t.doneAt ? 'default' : 'blue'} style={{ margin: 0 }}>
                  {overdue ? 'overdue ' : 'due '}
                  {date(t.dueDate)}
                </Tag>
              )}
              {t.doneAt && <span className="muted" style={{ fontSize: 12 }}>{t.doneByEmail?.split('@')[0]}</span>}
              <Popconfirm title="Remove task?" onConfirm={() => act(() => api(`/api/members/${member.id}/checklist/${t.id}`, { method: 'DELETE' }))}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          );
        })
      )}
      <Space.Compact style={{ marginTop: 12, width: '100%' }}>
        <Input placeholder="Add a task" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onPressEnter={() => newTitle.trim() && act(async () => { await api(`/api/members/${member.id}/checklist`, { method: 'POST', json: { kind, title: newTitle.trim(), dueDate: newDue?.format('YYYY-MM-DD') ?? null } }); setNewTitle(''); setNewDue(null); })} />
        <DatePicker placeholder="Due" value={newDue} onChange={setNewDue} style={{ width: 140 }} />
        <Button icon={<PlusOutlined />} disabled={!newTitle.trim()} loading={busy} onClick={() => act(async () => { await api(`/api/members/${member.id}/checklist`, { method: 'POST', json: { kind, title: newTitle.trim(), dueDate: newDue?.format('YYYY-MM-DD') ?? null } }); setNewTitle(''); setNewDue(null); })}>
          Add
        </Button>
      </Space.Compact>
    </Card>
  );
}

export function ChecklistTab({ member }: { member: TeamMember }) {
  const { message } = AntApp.useApp();
  const [data, setData] = useState<MemberChecklist | null>(null);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([api<MemberChecklist>(`/api/members/${member.id}/checklist`), api<{ templates: ChecklistTemplate[] }>('/api/checklists/templates')]);
      setData(c);
      setTemplates(t.templates);
    } catch (e) {
      message.error(describeError(e));
    }
  }, [member.id, message]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <Spin />;
  return (
    <Row gutter={16}>
      <Col xs={24} xl={12}>
        <KindSection kind="onboarding" member={member} data={data} templates={templates} onChange={load} />
      </Col>
      <Col xs={24} xl={12}>
        <KindSection kind="offboarding" member={member} data={data} templates={templates} onChange={load} />
      </Col>
    </Row>
  );
}
