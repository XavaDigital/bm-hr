import { useState } from 'react';
import { Alert, Button, Space, Table, Tag, Typography, Upload, App as AntApp } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { api, describeError } from '../api';
import type { ImportResult, ImportRowPlan } from '../types';

const ACTION_COLOR: Record<ImportRowPlan['action'], string> = { create: 'green', update: 'blue', skip: 'default', error: 'red' };

export function Import() {
  const { message } = AntApp.useApp();
  const [csv, setCsv] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api<ImportResult>('/api/members/import', { method: 'POST', json: { csv, dryRun } });
      setResult(r);
      if (!dryRun) message.success(`Imported: ${r.counts.create} created, ${r.counts.update} updated`);
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Import team from CSV
        </Typography.Title>
        <Button href="/api/members/import/template">Download template</Button>
      </div>
      <Typography.Paragraph className="muted">
        One row per person. Existing members are matched by email and updated; new emails are created. A pay_amount adds a
        compensation entry unless the same one already exists. Preview first, then apply.
      </Typography.Paragraph>
      <Space style={{ marginBottom: 16 }} wrap>
        <Upload
          accept=".csv,text/csv"
          maxCount={1}
          showUploadList={false}
          beforeUpload={async (file) => {
            setCsv(await file.text());
            setFileName(file.name);
            setResult(null);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>Choose CSV</Button>
        </Upload>
        {fileName && <Typography.Text>{fileName}</Typography.Text>}
        <Button disabled={!csv} loading={busy} onClick={() => run(true)}>
          Preview
        </Button>
        <Button type="primary" disabled={!result || !result.dryRun || result.counts.create + result.counts.update === 0} loading={busy} onClick={() => run(false)}>
          Apply {result?.dryRun ? `(${result.counts.create + result.counts.update})` : ''}
        </Button>
      </Space>

      {result && (
        <>
          <Alert
            style={{ marginBottom: 12 }}
            type={result.dryRun ? 'info' : 'success'}
            showIcon
            message={
              (result.dryRun ? 'Preview: ' : 'Applied: ') +
              `${result.counts.create} to create, ${result.counts.update} to update, ${result.counts.skip} unchanged, ${result.counts.error} with errors`
            }
          />
          <Table<ImportRowPlan>
            className="import-table"
            rowKey="line"
            size="small"
            pagination={false}
            dataSource={result.rows}
            columns={[
              { title: 'Line', dataIndex: 'line', width: 60 },
              { title: 'Name', dataIndex: 'name' },
              { title: 'Email', dataIndex: 'email', render: (e: string | null) => e ?? <span className="muted">—</span> },
              { title: 'Action', dataIndex: 'action', width: 90, render: (a: ImportRowPlan['action']) => <Tag color={ACTION_COLOR[a]}>{a}</Tag> },
              {
                title: 'Changes / errors',
                key: 'detail',
                render: (_, r) => (
                  <div>
                    {r.changes.map((c) => (
                      <div key={c}>{c}</div>
                    ))}
                    {r.errors.map((e) => (
                      <div key={e} style={{ color: '#cf1322' }}>
                        {e}
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
