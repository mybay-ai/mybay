import { describe, expect, it } from 'vitest';
import { formatTimelineDuration, groupTimelineBlocks } from './InlineRunTimeline';
import type { RunBlock, ToolRunBlock } from './runTypes';
const tool=(id:string):ToolRunBlock=>({id,type:'tool',firstSeq:1,lastSeq:2,toolCallId:id,tool:'file',status:'completed'});
describe('compact timeline grouping',()=>{
  it('groups only consecutive confirmed successes without hiding narration or attention states',()=>{
    const narration:RunBlock={id:'text',type:'text',content:'next action',firstSeq:3,lastSeq:3};
    const failure={...tool('failure'),status:'failed' as const};
    const unknown={...tool('unknown'),completionInferred:true};
    const pending:RunBlock={id:'approval',type:'approval',approvalId:'a',status:'pending',firstSeq:4,lastSeq:4};
    const group=['a','b','c','d'].map(tool);
    expect(groupTimelineBlocks([...group,narration,failure,unknown,pending,tool('last')])).toEqual([group,narration,failure,unknown,pending,tool('last')]);
  });
});

describe('localized timeline duration',()=>{
  const zh = { millisecond: '毫秒', second: '秒', minute: '分钟', hour: '小时' } as const;
  const en = { millisecond: 'ms', second: 's', minute: 'm', hour: 'h' } as const;
  it('formats seconds, minutes, and hours using the supplied locale units',()=>{
    expect(formatTimelineDuration(13_000, key => zh[key])).toBe('13秒');
    expect(formatTimelineDuration(73_000, key => zh[key])).toBe('1分钟 13秒');
    expect(formatTimelineDuration(3_733_000, key => zh[key])).toBe('1小时 2分钟 13秒');
    expect(formatTimelineDuration(3_733_000, key => en[key])).toBe('1h 2m 13s');
  });
});
