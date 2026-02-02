export type FilterMode = "any" | "only0" | "only1";
export type SortMode = "relevance" | "id_desc" | "id_asc";

export type TagInfo = { tagId: number; name: string; count: number; bit: number };
export type TagBrief = { tagId: number; name: string };

export type SearchResultItem = {
  id: number;
  title: string;
  cover: string;
  aliases: string[];
  authors: string[];
  tags: TagBrief[];
  hidden: boolean;
  isHideChapter: boolean;
  needLogin: boolean;
  isLock: boolean;
};

export type WorkerReadyMsg = {
  type: "ready";
  count: number;
  tags: TagInfo[];
  generatedAt: string;
};

export type WorkerProgressMsg = { type: "progress"; stage: string };

export type WorkerResultsMsg = {
  type: "results";
  requestId: number;
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
  items: SearchResultItem[];
};

export type WorkerOutMsg = WorkerReadyMsg | WorkerProgressMsg | WorkerResultsMsg;

export type WorkerInitMsg = { type: "init" };

export type WorkerSearchMsg = {
  type: "search";
  requestId: number;
  q: string;
  tagBits: number[];
  excludeTagBits: number[];
  hidden: FilterMode;
  hideChapter: FilterMode;
  needLogin: FilterMode;
  lock: FilterMode;
  sort: SortMode;
  page: number;
  size: number;
};

export type WorkerInMsg = WorkerInitMsg | WorkerSearchMsg;
