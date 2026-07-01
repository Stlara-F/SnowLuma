import { Group, Panel, Separator } from 'react-resizable-panels';
import { useTabs } from '@/contexts/TabContext';
import { TabContent } from './tab-content';
import type { SplitNode } from '@/types';

// ─── SplitView ───────────────────────────────────────────────────────────────
// Recursively renders a split tree using react-resizable-panels (v4 API).
// When splitTree is null, returns null — the parent renders TabContent directly.

interface SplitViewProps {
  activeTabId: string | null;
}

export function SplitView({ activeTabId }: SplitViewProps) {
  const { splitTree } = useTabs();

  if (!splitTree) return null;

  return <SplitNodeView node={splitTree} activeTabId={activeTabId} />;
}

interface SplitNodeViewProps {
  node: SplitNode;
  activeTabId: string | null;
}

function SplitNodeView({ node, activeTabId }: SplitNodeViewProps) {
  const { tabs } = useTabs();

  if (node.type === 'leaf') {
    const tab = tabs.find((t) => t.id === node.tabId);
    if (!tab) return null;
    return (
      <TabContent
        tab={tab}
        isActive={tab.id === activeTabId}
      />
    );
  }

  const orientation = node.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const panel0Id = `${node.groupId}-0`;
  const panel1Id = `${node.groupId}-1`;

  // Layout: flexGrow per panel id.
  const defaultLayout: Record<string, number> = {
    [panel0Id]: node.ratio,
    [panel1Id]: 1 - node.ratio,
  };

  return (
    <Group orientation={orientation} defaultLayout={defaultLayout}>
      <Panel id={panel0Id}>
        <SplitNodeView node={node.children[0]} activeTabId={activeTabId} />
      </Panel>
      <Separator className="group relative flex items-center justify-center bg-border/50 transition-colors hover:bg-border">
        <div
          className={`${
            orientation === 'horizontal' ? 'h-8 w-1' : 'h-1 w-8'
          } rounded-full bg-border transition-colors group-hover:bg-primary/50`}
        />
      </Separator>
      <Panel id={panel1Id}>
        <SplitNodeView node={node.children[1]} activeTabId={activeTabId} />
      </Panel>
    </Group>
  );
}
