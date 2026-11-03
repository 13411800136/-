import { useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CircleDashed,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  Factory,
  FilePlus2,
  FileText,
  Package,
  Paperclip,
  Send,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Upload
} from 'lucide-react';
import type { Attachment, OrderDetail, Profit, Stage, TimelineEvent } from '../../../lib/types';
import { api, errorMessage } from '../../../lib/api';
import { fmtDateTime, fmtMoney } from '../../../lib/format';
import { Alert, Button, Progress, SectionTitle, useToast } from '../../../components/ui';

const STAGE_ICONS: Record<string, typeof Check> = {
  ORDER: FilePlus2,
  PURCHASE: ShoppingCart,
  ARRIVAL: Truck,
  PLATING: CircleDashed,
  PRODUCTION: Factory,
  QC: ShieldCheck,
  PACKING: Package,
  SHIPPING: Send,
  COMPLETED: BadgeCheck
};

export function StageStepper({ stages }: { stages: Stage[] }) {
  return (
    <div className="stage-stepper">
      {stages.map((stage, index) => {
        const Icon = STAGE_ICONS[stage.key] ?? CircleDashed;
        return (
          <div key={stage.key} className={`stage stage-${stage.state.toLowerCase()}`}>
            <div className="stage-marker">
              <span className="stage-icon">
                {stage.state === 'DONE' ? <Check size={15} /> : <Icon size={15} />}
              </span>
              {index < stages.length - 1 ? <span className="stage-connector" /> : null}
            </div>
            <div className="stage-copy">
              <strong>{stage.label}</strong>
              <small>
                {stage.state === 'NOT_APPLICABLE'
                  ? '不适用'
                  : stage.state === 'DONE'
                    ? stage.at
                      ? fmtDateTime(stage.at).slice(5)
                      : '已完成'
                    : stage.state === 'ACTIVE'
                      ? '当前阶段'
                      : '待处理'}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProfitPanel({ profit }: { profit: Profit }) {
  const cost = profit.salesCents - profit.profitCents;
  const profitWidth = profit.salesCents > 0 ? Math.max(0, (profit.profitCents / profit.salesCents) * 100) : 0;
  return (
    <div className="profit-panel">
      <SectionTitle title="订单利润" hint="预计值 · 人民币不含税" />
      <div className="profit-panel-hero">
        <span>预计利润</span>
        <strong className={profit.profitCents < 0 ? 'negative' : ''}>{fmtMoney(profit.profit)}</strong>
        <span className="profit-panel-margin">毛利率 {profit.margin}%</span>
      </div>
      <div className="profit-stack" aria-hidden="true">
        <span className="profit-stack-profit" style={{ width: `${Math.min(100, profitWidth)}%` }} />
        <span className="profit-stack-cost" style={{ width: `${Math.max(0, 100 - profitWidth)}%` }} />
      </div>
      <div className="profit-lines">
        <div>
          <span>销售额</span>
          <strong>{fmtMoney(profit.sales)}</strong>
        </div>
        <div>
          <span>采购成本</span>
          <strong>− {fmtMoney(profit.purchaseCost)}</strong>
        </div>
        <div>
          <span>生产成本</span>
          <strong>− {fmtMoney(profit.productionCost)}</strong>
        </div>
        <div>
          <span>电镀成本</span>
          <strong>{fmtMoney(profit.platingCost)}</strong>
        </div>
        <div className="profit-total">
          <span>成本合计</span>
          <strong>{fmtMoney((cost / 100).toFixed(2))}</strong>
        </div>
      </div>
      <p className="profit-scope">{profit.scopeNote}</p>
    </div>
  );
}

const EVENT_META: Record<
  string,
  { label: string; icon: typeof Check; tone: string }
> = {
  ORDER_CREATED: { label: '订单创建', icon: FilePlus2, tone: 'slate' },
  PURCHASE_CREATED: { label: '采购单建立', icon: ShoppingCart, tone: 'amber' },
  ARRIVAL_RECORDED: { label: '物流到货', icon: Truck, tone: 'cyan' },
  PRODUCTION_DISPATCHED: { label: '生产下发', icon: Factory, tone: 'teal' },
  PRODUCTION_FEEDBACK: { label: '生产反馈', icon: ClipboardCheck, tone: 'teal' },
  QC_DISPATCHED: { label: '质检下发', icon: ShieldCheck, tone: 'violet' },
  QC_RECORDED: { label: '质检录入', icon: ClipboardCheck, tone: 'violet' },
  QC_PASSED: { label: '质检放行', icon: ShieldCheck, tone: 'green' },
  PACKING_DISPATCHED: { label: '包装下发', icon: Package, tone: 'orange' },
  PACKING_RECORDED: { label: '包装完成', icon: Package, tone: 'orange' },
  SHIPMENT_TRIGGERED: { label: '发货触发', icon: Send, tone: 'blue' },
  SHIPMENT_RECORDED: { label: '物流发货', icon: Truck, tone: 'blue' },
  ORDER_COMPLETED: { label: '订单完成', icon: BadgeCheck, tone: 'green' },
  EXCEPTION_REPORTED: { label: '现场异常', icon: AlertTriangle, tone: 'danger' },
  PRICE_VISIBILITY_CHANGED: { label: '单价可见性变更', icon: Eye, tone: 'slate' }
};

export function OrderTimeline({ events, loading }: { events: TimelineEvent[]; loading: boolean }) {
  const sorted = [...events].reverse();
  return (
    <div className="timeline">
      {loading ? <p className="muted-note">正在读取时间线…</p> : null}
      {!loading && sorted.length === 0 ? <p className="muted-note">还没有业务事件。</p> : null}
      {sorted.map((event) => {
        const meta = EVENT_META[event.event_type] ?? { label: event.event_type, icon: CircleDashed, tone: 'slate' };
        const Icon = meta.icon;
        return (
          <div key={event.id} className="timeline-item">
            <span className={`timeline-icon tone-${meta.tone}`}>
              <Icon size={15} />
            </span>
            <div className="timeline-body">
              <div className="timeline-head">
                <strong>{meta.label}</strong>
                {event.quantity !== null ? <span className="timeline-qty">{event.quantity} 件</span> : null}
                <time>{fmtDateTime(event.created_at)}</time>
              </div>
              <p>
                {event.actor_name}
                {event.event_type === 'PRICE_VISIBILITY_CHANGED' && event.payload
                  ? ` · 单价${(event.payload as { priceVisible?: boolean }).priceVisible ? '可见' : '隐藏'}`
                  : ''}
                {event.event_type === 'EXCEPTION_REPORTED' && event.payload
                  ? ` · ${String((event.payload as { description?: string }).description ?? '')}`
                  : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AttachmentPanel({
  orderId,
  attachments,
  onChanged
}: {
  orderId: string;
  attachments: Attachment[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    setError(null);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('只允许上传 PDF 文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('文件不能超过 5 MB');
      return;
    }
    setUploading(true);
    try {
      await api.upload(`/orders/${orderId}/attachments`, file);
      toast.success('附件已上传', file.name);
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const download = async (attachment: Attachment) => {
    try {
      const { blob, filename } = await api.download(`/attachments/${attachment.id}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      toast.error('下载失败', errorMessage(reason));
    }
  };

  return (
    <div className="attachment-panel">
      <SectionTitle
        title="订单附件"
        hint="仅 PDF · 最大 5 MB"
        action={
          <Button size="sm" variant="secondary" icon={<Upload size={14} />} loading={uploading} onClick={pick}>
            上传
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error ? <p className="field-error">{error}</p> : null}
      {attachments.length === 0 ? (
        <div className="attachment-empty">
          <Paperclip size={18} />
          <span>暂无附件。可上传 PDF 图纸或确认单。</span>
        </div>
      ) : (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span className="attachment-icon">
                <FileText size={17} />
              </span>
              <div className="attachment-copy">
                <strong title={attachment.originalName}>{attachment.originalName}</strong>
                <small>
                  {(attachment.size / 1024).toFixed(1)} KB · {attachment.uploadedByName} · {fmtDateTime(attachment.createdAt)}
                </small>
              </div>
              <button type="button" className="icon-button" onClick={() => void download(attachment)} aria-label="下载附件">
                <Download size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeliverySummary({
  detail,
  onPack,
  onShip
}: {
  detail: OrderDetail;
  onPack?: () => void;
  onShip?: () => void;
}) {
  const summary = detail.summary;
  const packing = detail.packing.reduce((sum, row) => sum + row.quantity, 0);
  const shipped = detail.shipments.reduce((sum, row) => sum + row.quantity, 0);
  return (
    <div className="delivery-summary">
      <div className="delivery-metric">
        <span>已放行</span>
        <strong>{summary.quantities.released}</strong>
        <Progress value={summary.quantities.released} max={summary.quantities.ordered} />
      </div>
      <div className="delivery-metric">
        <span>已包装</span>
        <strong>{packing}</strong>
        <Progress value={packing} max={summary.quantities.ordered} tone="orange" />
      </div>
      <div className="delivery-metric">
        <span>已发货</span>
        <strong>{shipped}</strong>
        <Progress value={shipped} max={summary.quantities.ordered} tone="blue" />
      </div>
      <div className="delivery-actions">
        {onPack ? (
          <Button size="sm" variant="secondary" icon={<Package size={14} />} onClick={onPack}>
            下发包装
          </Button>
        ) : null}
        {onShip ? (
          <Button size="sm" variant="secondary" icon={<Send size={14} />} onClick={onShip}>
            触发发货
          </Button>
        ) : null}
        {!onPack && !onShip ? (
          <Alert tone="info">
            当前交付进度 {shipped}/{summary.quantities.ordered}，{summary.nextStep}。
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

export function PriceVisibility({
  visible,
  onToggle,
  busy
}: {
  visible: boolean;
  onToggle: () => void;
  busy: boolean;
}) {
  return (
    <button type="button" className={visible ? 'price-toggle price-toggle-on' : 'price-toggle'} onClick={onToggle} disabled={busy}>
      {visible ? <Eye size={14} /> : <EyeOff size={14} />}
      <span>{visible ? '生产端可见单价' : '生产端隐藏单价'}</span>
    </button>
  );
}
