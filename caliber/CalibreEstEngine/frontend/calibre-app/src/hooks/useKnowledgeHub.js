import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRoleContext } from '../contexts/RoleContext';
import { CAPABILITIES } from '../constants/capabilities';
import { BUSINESS_UNITS } from '../constants/business-units';
import { getVisibleSubdivisions, TYPE_TO_SUBDIVISION } from '../constants/subdivisions';

const DOWNLOAD_TOAST_DURATION = 3000;

// ── Folder name to BU mapping ────────────────────────────────────────────────
const FOLDER_TO_BU = {
  ESU: 'esu', ADM: 'adm', ITIS: 'itis', BPS: 'bps', TI: 'ti',
  CYBER: 'cyber', AI: 'ai', DATACLOUD: 'datacloud', IAE: 'iae',
  BFSI: 'bfsi', iON: 'ion', _global: 'general'
};

// ── Helper to format file size ───────────────────────────────────────────────
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ── Heuristics to derive type from filename if sidecar JSON is missing ─────────
function deriveTypeFromFilename(name, subFolder) {
  if (subFolder === 'templates') return 'template';
  const lower = name.toLowerCase();
  if (lower.includes('guideline')) return 'guideline';
  if (lower.includes('pov') || lower.includes('point of view')) return 'pov';
  if (lower.includes('case study') || lower.includes('casestudy')) return 'casestudy';
  if (lower.includes('playbook')) return 'playbook';
  if (lower.includes('rate') || lower.includes('cost') || lower.includes('card')) return 'ratecard';
  if (lower.includes('benchmark') || lower.includes('baseline')) return 'benchmark';
  if (lower.includes('faq') || lower.includes('question')) return 'faq';
  if (lower.includes('whitepaper') || lower.includes('white paper')) return 'whitepaper';
  if (lower.includes('proposal')) return 'proposal';
  if (lower.includes('video') || lower.includes('training')) return 'video';
  return 'guideline'; // default fallback for data folder
}

// ── Maps backend file payload to UI item ──────────────────────────────────────
function mapServerFileToItem(file) {
  const meta = file.metadata || {};

  // Extract BU folder and subfolder by finding the indices relative to 'KnowledgeHub'
  const pathParts = (file.path || '').replace(/\\/g, '/').split('/');
  const khIndex   = pathParts.indexOf('KnowledgeHub');
  const buFolder  = khIndex !== -1 && pathParts[khIndex + 1] ? pathParts[khIndex + 1] : '_global';
  const subFolder = khIndex !== -1 && pathParts[khIndex + 2] ? pathParts[khIndex + 2] : 'data';

  // Derived properties from folder structure (backup for missing sidecar JSON)
  const derivedUnitId = FOLDER_TO_BU[buFolder] || 'general';
  const derivedType   = deriveTypeFromFilename(file.name, subFolder);

  const finalUnitId = meta.unitId || derivedUnitId;
  const finalType   = meta.type   || derivedType;

  return {
    id:           meta.id || `uploaded-${file.name}-${new Date(file.modified).getTime()}`,
    title:        meta.title || file.name,
    subtitle:     meta.version ? `Version ${meta.version}` : 'Uploaded document',
    type:         finalType,
    unitId:       finalUnitId,
    programType:  meta.programType || 'general',
    description:  meta.description || 'No description provided.',
    fileType:     meta.fileType || file.name.split('.').pop().toLowerCase(),
    fileSize:     formatFileSize(file.size),
    owner:        meta.uploaderRole ? `COE (${meta.uploaderRole})` : 'System',
    ownerRole:    meta.uploaderRole || 'Admin / COE',
    uploadedAt:   meta.uploadedAt || file.modified,
    updatedAt:    file.modified,
    downloadsCount: 0,
    tags:         meta.tags || [],
    relatedIds:   [],
    evaInsight:   `This is an uploaded ${finalType} under the ${finalUnitId.toUpperCase()} unit.`,
    isNew:        true,
    filePath:     file.path,
  };
}

export function useKnowledgeHub() {
  const { currentRoleId, setActiveUnitId, can } = useRoleContext();
  // Capability-driven, replacing eight copies of an inline
  // `role === 'admin' || role === 'sme'` test. That hardcoded rule also
  // disagreed with the server, which permits `super` to see rate cards.
  const canReviewKnowledge = can(CAPABILITIES.KNOWLEDGE_REVIEW);
  const canSeeRateCards = can(CAPABILITIES.RATE_CARD_VIEW);
  // Rate cards follow RATE_CARD_VIEW; other raw `data` artifacts are a
  // curation concern, so they follow KNOWLEDGE_REVIEW.
  const hideItem = useCallback(
    (c) => (c.type === 'ratecard' && !canSeeRateCards)
      || (c.type === 'data' && !canReviewKnowledge),
    [canSeeRateCards, canReviewKnowledge],
  );
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Navigation ────────────────────────────────────────────────────────────
  const [selectedUnitId, setSelectedUnitId] = useState('all');

  // ── Subdivision filter ────────────────────────────────────────────────────
  const [activeSubdivision, setActiveSubdivision] = useState(null);

  // ── Program type filter ───────────────────────────────────────────────────
  const [activeProgramType, setActiveProgramType] = useState(null);

  // ── Content type filter (legacy — kept for search overlay compat) ─────────
  const [activeContentType, setActiveContentType] = useState('all');

  // ── Search ────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // ── View mode ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'

  // ── Right panel selection ─────────────────────────────────────────────────
  const [selectedItem, setSelectedItem] = useState(null);

  // ── Detail modal ──────────────────────────────────────────────────────────
  const [modalItem, setModalItem] = useState(null);

  // ── Upload modal ──────────────────────────────────────────────────────────
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // ── Right panel visibility ────────────────────────────────────────────────
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // ── Download state (local tracking) ──────────────────────────────────────
  const [downloadCounts, setDownloadCounts] = useState({});
  const [activeDownload, setActiveDownload] = useState(null); // { id, title, fileType, fileSize, progress }
  const downloadTimerRef = useRef(null);

  // ── Local Items & Fetching (Disk-backed Filesystem list) ─────────────────
  const [localItems, setLocalItems] = useState([]);

  // Fetch uploaded files from backend on mount
  useEffect(() => {
    let active = true;
    async function loadFiles() {
      try {
        const res = await fetch('http://localhost:3001/api/files', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const data = await res.json();
        if (data.success && active) {
          const mapped = data.files.map(mapServerFileToItem);
          console.debug('[KNOWLEDGE HUB RAW FILES]', data.files);
          console.debug('[KNOWLEDGE HUB MAPPED ITEMS]', mapped);
          setLocalItems(mapped);
        }
      } catch (err) {
        console.error('Failed to load uploaded files from server:', err.message);
      }
    }
    loadFiles();
    return () => { active = false; };
  }, []);

  // ── Deep-link: open an item via ?item=<filePath> (e.g. an EVA citation
  // click) once it's loaded. filePath is the stable identifier — see
  // mapServerFileToItem's `id` fallback comment above for why `id` alone
  // isn't reliable enough for permalinks. Clears the param after a match
  // (no history entry) so it doesn't re-trigger on later localItems updates.
  useEffect(() => {
    const target = searchParams.get('item');
    if (!target || localItems.length === 0) return;

    const match = localItems.find((it) => it.filePath === target);
    if (match) {
      setSelectedUnitId(match.unitId);
      setActiveUnitId(match.unitId);
      setActiveSubdivision(null);
      setActiveProgramType(null);
      setSelectedItem(match);
      setIsRightPanelOpen(true);

      const next = new URLSearchParams(searchParams);
      next.delete('item');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, localItems, setActiveUnitId, setSearchParams]);

  const onUploadComplete = useCallback((newItem) => {
    // Reload file list from server to get metadata sidecar in place
    fetch('http://localhost:3001/api/files', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setLocalItems(data.files.map(mapServerFileToItem));
        } else {
          setLocalItems((prev) => [newItem, ...prev]);
        }
      })
      .catch(() => {
        setLocalItems((prev) => [newItem, ...prev]);
      });
    setIsUploadOpen(false);
  }, []);

  // ── Derived: can upload ───────────────────────────────────────────────────
  const canUpload = can(CAPABILITIES.KNOWLEDGE_REVIEW);

  // ── Derived: current BU ───────────────────────────────────────────────────
  const currentUnit = useMemo(
    () => BUSINESS_UNITS.find((bu) => bu.id === selectedUnitId) || null,
    [selectedUnitId]
  );

  // ── Derived: visible subdivisions for this role ───────────────────────────
  const visibleSubdivisions = useMemo(
    () => getVisibleSubdivisions(currentRoleId),
    [currentRoleId]
  );

  // ── Derived: all unit stats (calculated dynamically from files on disk) ───
  const allUnitStats = useMemo(() => {
    const stats = {};
    BUSINESS_UNITS.forEach((bu) => {
      const buItems = localItems.filter((item) => item.unitId === bu.id);
      const uniqueTypes = new Set(buItems.map((item) => item.type));
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const newCount = buItems.filter((item) => new Date(item.uploadedAt) > sevenDaysAgo).length;

      stats[bu.id] = {
        total: buItems.length,
        newThisWeek: newCount,
        typesCount: uniqueTypes.size,
      };
    });
    return stats;
  }, [localItems]);

  // ── Derived: filtered content ─────────────────────────────────────────────
  const filteredContent = useMemo(() => {
    let items = localItems;

    // 0. Role-gate: hide sensitive cost/rate data types from non-admin/non-sme roles
    items = items.filter((c) => !hideItem(c));

    // 1. Search query filter
    if (searchQuery.trim().length > 1) {
      const q = searchQuery.toLowerCase();
      items = items.filter((c) => 
        c.title.toLowerCase().includes(q) || 
        c.description.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // 2. Unit filter
    if (selectedUnitId !== 'all') {
      items = items.filter((c) => c.unitId === selectedUnitId);
    }

    // 3. Subdivision filter (maps to raw types)
    if (activeSubdivision) {
      const sub = visibleSubdivisions.find((s) => s.id === activeSubdivision);
      if (sub) {
        items = items.filter((c) => sub.types.includes(c.type));
      }
    }

    // 4. Program type filter
    if (activeProgramType && activeProgramType !== 'general') {
      items = items.filter((c) => c.programType === activeProgramType);
    } else if (activeProgramType === 'general') {
      items = items.filter((c) => !c.programType || c.programType === 'general');
    }

    // 5. Legacy content type filter (for header type tabs — kept for compat)
    if (activeContentType !== 'all') {
      items = items.filter((c) => c.type === activeContentType);
    }

    return items;
  }, [localItems, searchQuery, selectedUnitId, activeContentType, activeSubdivision, activeProgramType, hideItem, visibleSubdivisions]);

  // ── Derived: search results grouped by type (for overlay) ─────────────────
  const searchResults = useMemo(() => {
    if (searchQuery.trim().length < 2) return [];
    const q = searchQuery.toLowerCase();
    return localItems
      .filter((c) => {
        const roleMatch = !hideItem(c);
        const searchMatch = c.title.toLowerCase().includes(q) || 
                            c.description.toLowerCase().includes(q) ||
                            c.tags.some(t => t.toLowerCase().includes(q));
        return roleMatch && searchMatch;
      })
      .slice(0, 12);
  }, [searchQuery, localItems, hideItem]);

  // ── Derived: type counts for filter tabs ──────────────────────────────────
  const typeCounts = useMemo(() => {
    let base = localItems;
    base = base.filter((c) => !hideItem(c));
    if (selectedUnitId !== 'all') base = base.filter((c) => c.unitId === selectedUnitId);
    const counts = { all: base.length };
    base.forEach((c) => { counts[c.type] = (counts[c.type] || 0) + 1; });
    return counts;
  }, [localItems, selectedUnitId, hideItem]);

  // ── Derived: subdivision counts (for the subdivision nav) ────────────────
  const subdivisionCounts = useMemo(() => {
    let base = localItems;
    base = base.filter((c) => !hideItem(c));
    if (selectedUnitId !== 'all') base = base.filter((c) => c.unitId === selectedUnitId);
    const counts = {};
    base.forEach((c) => {
      const subId = TYPE_TO_SUBDIVISION[c.type];
      if (subId) counts[subId] = (counts[subId] || 0) + 1;
    });
    return counts;
  }, [localItems, selectedUnitId, hideItem]);

  // ── Derived: program type counts for active subdivision ───────────────────
  const programTypeCounts = useMemo(() => {
    if (!activeSubdivision) return {};
    let base = localItems;
    base = base.filter((c) => !hideItem(c));
    if (selectedUnitId !== 'all') base = base.filter((c) => c.unitId === selectedUnitId);
    const sub = visibleSubdivisions.find((s) => s.id === activeSubdivision);
    if (sub) base = base.filter((c) => sub.types.includes(c.type));
    const counts = {};
    base.forEach((c) => {
      const pt = c.programType || 'general';
      counts[pt] = (counts[pt] || 0) + 1;
    });
    return counts;
  }, [localItems, activeSubdivision, selectedUnitId, hideItem, visibleSubdivisions]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const selectUnit = useCallback((id) => {
    setSelectedUnitId(id);
    setActiveUnitId(id === 'all' ? null : id);
    setActiveContentType('all');
    setActiveSubdivision(null);
    setActiveProgramType(null);
    setSelectedItem(null);
    setSearchQuery('');
    setIsSearchOpen(false);
  }, [setActiveUnitId]);

  const selectSubdivision = useCallback((subId) => {
    setActiveSubdivision(subId);
    setActiveProgramType(null);
    setActiveContentType('all');
  }, []);

  const selectItem = useCallback((item) => {
    setSelectedItem(item);
    if (!isRightPanelOpen) setIsRightPanelOpen(true);
  }, [isRightPanelOpen]);

  const clearSelection = useCallback(() => setSelectedItem(null), []);

  const openModal = useCallback((item) => setModalItem(item), []);
  const closeModal = useCallback(() => setModalItem(null), []);

  const openUpload = useCallback(() => {
    if (canUpload) setIsUploadOpen(true);
  }, [canUpload]);

  const closeUpload = useCallback(() => setIsUploadOpen(false), []);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'));
  }, []);

  const toggleRightPanel = useCallback(() => {
    setIsRightPanelOpen((prev) => !prev);
  }, []);

  const clearAllFilters = useCallback(() => {
    setSelectedUnitId('all');
    setActiveContentType('all');
    setActiveSubdivision(null);
    setActiveProgramType(null);
    setSearchQuery('');
    setIsSearchOpen(false);
  }, []);

  const handleSearchFocus = useCallback(() => {
    if (searchQuery.trim().length >= 2) setIsSearchOpen(true);
  }, [searchQuery]);

  const handleSearchChange = useCallback((val) => {
    setSearchQuery(val);
    setIsSearchOpen(val.trim().length >= 2);
  }, []);

  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  // ── Download item ─────────────────────────────────────────────────────────
  const downloadItem = useCallback((item) => {
    if (!item) return;
    // Cancel any in-progress download
    if (downloadTimerRef.current) clearInterval(downloadTimerRef.current);

    setActiveDownload({ id: item.id, title: item.title, fileType: item.fileType, fileSize: item.fileSize, progress: 0 });

    // Simulate progress
    let progress = 0;
    const rate = 3 + Math.random() * 4; // 3-7% per tick
    downloadTimerRef.current = setInterval(() => {
      progress += rate;
      if (progress >= 100) {
        progress = 100;
        clearInterval(downloadTimerRef.current);
        setDownloadCounts((prev) => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }));
        setActiveDownload((prev) => prev ? { ...prev, progress: 100, done: true } : null);
        setTimeout(() => setActiveDownload(null), DOWNLOAD_TOAST_DURATION);
      } else {
        setActiveDownload((prev) => prev ? { ...prev, progress: Math.round(progress) } : null);
      }
    }, 80);
  }, []);

  const dismissDownload = useCallback(() => {
    if (downloadTimerRef.current) clearInterval(downloadTimerRef.current);
    setActiveDownload(null);
  }, []);

  // Return filtered filesystem content
  const allContent = filteredContent;

  // ── Active filters for pill bar ───────────────────────────────────────────
  const activeFilters = useMemo(() => {
    const filters = [];
    if (selectedUnitId !== 'all') filters.push({ id: 'unit', label: currentUnit?.code || selectedUnitId, onRemove: () => { setSelectedUnitId('all'); setActiveSubdivision(null); setActiveProgramType(null); } });
    if (activeSubdivision) filters.push({ id: 'sub', label: activeSubdivision, onRemove: () => { setActiveSubdivision(null); setActiveProgramType(null); } });
    if (activeProgramType) filters.push({ id: 'pt', label: activeProgramType, onRemove: () => setActiveProgramType(null) });
    if (searchQuery.trim()) filters.push({ id: 'search', label: `"${searchQuery}"`, onRemove: () => setSearchQuery('') });
    return filters;
  }, [selectedUnitId, activeSubdivision, activeProgramType, searchQuery, currentUnit]);

  return {
    // Navigation
    selectedUnitId, selectUnit,
    currentUnit, allUnitStats,

    // Subdivisions
    activeSubdivision, selectSubdivision,
    visibleSubdivisions, subdivisionCounts,

    // Program type
    activeProgramType, setActiveProgramType,
    programTypeCounts,

    // Filtering (legacy)
    activeContentType, setActiveContentType,
    typeCounts,

    // Search
    searchQuery, handleSearchChange,
    isSearchOpen, handleSearchFocus, closeSearch,
    searchResults,

    // View
    viewMode, toggleViewMode,
    isRightPanelOpen, toggleRightPanel,

    // Content
    filteredContent: allContent,

    // Selection
    selectedItem, selectItem, clearSelection,

    // Modals
    modalItem, openModal, closeModal,
    isUploadOpen, openUpload, closeUpload, canUpload,

    // Download
    downloadItem, downloadCounts, activeDownload, dismissDownload,

    // Upload
    onUploadComplete,

    // Filters
    activeFilters, clearAllFilters,
  };
}
