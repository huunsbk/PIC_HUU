/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import ExcelJS from 'exceljs';
import { useTournamentStore } from '../store';
import { calculateGroupStandings, getReadableTeamName, getReadableKoMatchName, balanceMatchesRestTime } from '../utils/tournamentEngine';
import {
  FileSpreadsheet,
  Printer,
  FileDown,
  Info,
  CheckCircle2,
  Trophy,
  Layers,
  CalendarDays,
  Sparkles,
  ChevronRight
} from 'lucide-react';

export default function ExportManager() {
  const {
    teams,
    groups,
    matches,
    tournament,
    events,
    addLog,
  } = useTournamentStore();

  const [selectedEventFilter, setSelectedEventFilter] = useState<string>('all');
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [printOnlyMatches, setPrintOnlyMatches] = useState(true);

  const eventList = Object.values(events || {});

  // Hàm tính Standing cho một Event bất kỳ
  const getEventStandings = (evt: typeof events[string]) => {
    const stdRecord: Record<string, ReturnType<typeof calculateGroupStandings>> = {};
    const groupList = Object.values(evt.groups || {});
    groupList.forEach((g) => {
      const groupMatches = (evt.matches || []).filter((m) => m.groupId === g.id);
      stdRecord[g.id] = calculateGroupStandings(
        g.id, 
        g.teamIds, 
        groupMatches, 
        evt.teams || {}, 
        evt.settings
      );
    });
    return stdRecord;
  };

  const handleExportLiveExcel = async () => {
    setIsExportingExcel(true);
    setExportSuccess(false);
    try {
      const workbook = new ExcelJS.Workbook();

      // Quyết định danh sách events cần xuất
      let eventsToExport: any[] = [];
      if (selectedEventFilter === 'all') {
        eventsToExport = Object.values(events || {});
      } else {
        const singleEvent = events[selectedEventFilter];
        if (singleEvent) {
          eventsToExport = [singleEvent];
        }
      }

      if (eventsToExport.length === 0) {
        setIsExportingExcel(false);
        return;
      }

      eventsToExport.forEach((evt: any) => {
        // Tên sheet Excel tối đa 30 ký tự, lược bỏ ký tự đặc biệt \/?:*[]
        const rawSheetName = evt.name || 'Noi_dung';
        const cleanSheetName = rawSheetName.replace(/[\\\/\?\*\[\]\:]/g, '');
        const sheetName = cleanSheetName.substring(0, 30) || `Nội dung ${evt.id}`;
        
        const worksheet = workbook.addWorksheet(sheetName);

        // Hiển thị đường lưới trong Excel
        worksheet.views = [{ showGridLines: true }];

        // Cố định kích thước các cột dữ liệu chính
        worksheet.columns = [
          { key: 'colA', width: 10 },
          { key: 'colB', width: 22 },
          { key: 'colC', width: 35 },
          { key: 'colD', width: 15 },
          { key: 'colE', width: 35 },
          { key: 'colF', width: 20 },
          { key: 'colG', width: 15 }
        ];

        // 1. DÒNG TIÊU ĐỀ CHÍNH: In đậm, cỡ chữ 16 căn giữa
        worksheet.mergeCells('A1:G1');
        const mainTitle = worksheet.getCell('A1');
        mainTitle.value = `LỊCH ĐẤU & ĐIỂM SỐ MỚI NHẤT - NỘI DUNG: ${String(evt.name).toUpperCase()}`;
        mainTitle.font = { name: 'Times New Roman', size: 16, bold: true };
        mainTitle.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 40;

        // Dòng phụ đề
        worksheet.mergeCells('A2:G2');
        const subTitle = worksheet.getCell('A2');
        subTitle.value = `GIẢI ĐẤU: ${String(tournament.name).toUpperCase()} | Sân: ${tournament.location || 'Trung tâm'} | Ngày lập: 2026`;
        subTitle.font = { name: 'Times New Roman', size: 12, italic: true };
        subTitle.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(2).height = 25;

        // Dòng trống cách quãng
        worksheet.addRow([]);
        worksheet.getRow(3).height = 15;

        let curRowIdx = 4;

        // --- MỤC I. BẢNG XẾP HẠNG VÒNG BẢNG (Như một tiêu đề trung gian -> 16 bold căn giữa) ---
        worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
        const m1Title = worksheet.getCell(`A${curRowIdx}`);
        m1Title.value = `I. BẢNG XẾP HẠNG VÒNG BẢNG`;
        m1Title.font = { name: 'Times New Roman', size: 16, bold: true };
        m1Title.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(curRowIdx).height = 30;
        curRowIdx++;

        // Dòng trống
        worksheet.addRow([]);
        worksheet.getRow(curRowIdx).height = 10;
        curRowIdx++;

        const groupList: any[] = Object.values(evt.groups || {});
        const stdByGrp: any = getEventStandings(evt);

        if (groupList.length === 0) {
          worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
          const emptyCell = worksheet.getCell(`A${curRowIdx}`);
          emptyCell.value = 'Chưa thiết lập bảng đấu cho nội dung này';
          emptyCell.font = { name: 'Times New Roman', size: 14, italic: true };
          emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
          worksheet.getRow(curRowIdx).height = 25;
          curRowIdx++;
        } else {
          groupList.forEach((group: any) => {
            // Tên Bảng đấu
            worksheet.mergeCells(`A${curRowIdx}:D${curRowIdx}`);
            const groupTitle = worksheet.getCell(`A${curRowIdx}`);
            groupTitle.value = `BẢNG ĐẤU: ${String(group.name).toUpperCase()}`;
            groupTitle.font = { name: 'Times New Roman', size: 16, bold: true };
            groupTitle.alignment = { horizontal: 'center', vertical: 'middle' };
            worksheet.getRow(curRowIdx).height = 28;
            curRowIdx++;

            // Headers của standings bảng
            const stdHeaders = ['Thứ hạng', 'Tên Đội tuyển / Vận động viên', 'Trận đã đấu', 'Điểm số'];
            const headerRow = worksheet.addRow([...stdHeaders]);
            worksheet.getRow(curRowIdx).height = 26;

            headerRow.eachCell((cell) => {
              cell.font = { name: 'Times New Roman', size: 14, bold: true };
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE8F4F8' }
              };
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'medium' },
                right: { style: 'thin' }
              };
            });
            curRowIdx++;

            const std = stdByGrp[group.id] || [];
            std.forEach((s: any, rankIndex: number) => {
              const dataRow = worksheet.addRow([
                rankIndex + 1,
                s.teamName || 'Không rõ',
                s.matchesPlayed || 0,
                `${s.points || 0}đ`
              ]);
              worksheet.getRow(curRowIdx).height = 25;

              dataRow.eachCell((cell) => {
                cell.font = { name: 'Times New Roman', size: 14 };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = {
                  top: { style: 'thin' },
                  left: { style: 'thin' },
                  bottom: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });
              curRowIdx++;
            });

            // Khoảng trống sau mỗi bảng
            worksheet.addRow([]);
            worksheet.getRow(curRowIdx).height = 12;
            curRowIdx++;
          });
        }

        // --- MỤC II. LỊCH THI ĐẤU & ĐIỂM SỐ MỚI NHẤT ---
        worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
        const m2Title = worksheet.getCell(`A${curRowIdx}`);
        m2Title.value = `II. LỊCH THI ĐẤU & ĐIỂM SỐ MỚI NHẤT`;
        m2Title.font = { name: 'Times New Roman', size: 16, bold: true };
        m2Title.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(curRowIdx).height = 30;
        curRowIdx++;

        // Dòng trống
        worksheet.addRow([]);
        worksheet.getRow(curRowIdx).height = 10;
        curRowIdx++;

        // Header Trận đấu
        const matchesHeaders = ['STT', 'Bảng / Nhánh', 'Vòng đấu', 'Đội tuyển A (Thứ nhất)', 'Tỷ số', 'Đội tuyển B (Thứ hai)', 'Trạng thái'];
        const matchHeaderRow = worksheet.addRow([...matchesHeaders]);
        worksheet.getRow(curRowIdx).height = 28;

        matchHeaderRow.eachCell((cell) => {
          cell.font = { name: 'Times New Roman', size: 14, bold: true };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8F4F8' }
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'medium' },
            right: { style: 'thin' }
          };
        });
        curRowIdx++;

        const evtMatches = evt.matches || [];
        if (evtMatches.length === 0) {
          worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
          const emptyCell = worksheet.getCell(`A${curRowIdx}`);
          emptyCell.value = 'Chưa thiết lập lịch thi đấu nào';
          emptyCell.font = { name: 'Times New Roman', size: 14, italic: true };
          emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
          emptyCell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          worksheet.getRow(curRowIdx).height = 25;
          curRowIdx++;
        } else {
          const groupMtch = evtMatches.filter((m: any) => m.groupId !== 'knockout');
          const koMtch = evtMatches.filter((m: any) => m.groupId === 'knockout');

          const balancedGroupMatches = balanceMatchesRestTime(groupMtch);
          const sortedAllList = [...balancedGroupMatches, ...koMtch];

          sortedAllList.forEach((m: any, mIdx: number) => {
            const tAName = evt.teams[m.teamAId]?.name || getReadableTeamName(m.teamAId, evt.groups);
            const tBName = evt.teams[m.teamBId]?.name || getReadableTeamName(m.teamBId, evt.groups);

            let gLabel = 'Vòng loại trực tiếp';
            if (m.groupId !== 'knockout') {
              const grpo = evt.groups[m.groupId];
              gLabel = grpo ? grpo.name : `Bảng ${m.groupId}`;
            }

            let rLabel = `Vòng ${m.round}`;
            if (m.groupId === 'knockout') {
              rLabel = m.knockoutRoundName || 'Trực tiếp';
              if (m.knockoutMatchId) {
                rLabel += ` (${getReadableKoMatchName(m.knockoutMatchId)})`;
              }
            }

            const scText = m.status === 'finished' ? `${m.scoreA} - ${m.scoreB}` : 'Chờ đấu';
            
            let stText = 'Chưa đấu';
            if (m.status === 'finished') {
              stText = m.scoreA! > m.scoreB! ? 'A thắng' : m.scoreB! > m.scoreA! ? 'B thắng' : 'Hòa';
            }

            const rowData = worksheet.addRow([
              mIdx + 1,
              gLabel,
              rLabel,
              tAName,
              scText,
              tBName,
              stText
            ]);

            worksheet.getRow(curRowIdx).height = 26;

            rowData.eachCell((cell) => {
              cell.font = { name: 'Times New Roman', size: 14 };
              cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            curRowIdx++;
          });
        }
      });

      // Tạo nhị phân tải xuống
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const fileSuffix = selectedEventFilter === 'all' ? 'toan_bo_noi_dung' : `noi_dung_${selectedEventFilter}`;
      link.download = `lich_va_ti_so_${fileSuffix}_${Date.now()}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      if (addLog) {
        addLog('Xuất Excel', `Đã xuất lịch thi đấu & điểm số truyền hình thành công.`);
      }

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 4000);
    } catch (err) {
      console.error('Lỗi xuất Excel:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Tính toán sơ bộ tổng số lượng dành cho Box tóm tắt thông tin
  const getSummaryMetrics = () => {
    let totEvents = 0;
    let totGroups = 0;
    let totTeams = 0;
    let totMatches = 0;

    if (selectedEventFilter === 'all') {
      totEvents = eventList.length;
      eventList.forEach(e => {
        totGroups += Object.keys(e.groups || {}).length;
        totTeams += Object.keys(e.teams || {}).length;
        totMatches += (e.matches || []).length;
      });
    } else {
      const e = events[selectedEventFilter];
      if (e) {
        totEvents = 1;
        totGroups = Object.keys(e.groups || {}).length;
        totTeams = Object.keys(e.teams || {}).length;
        totMatches = (e.matches || []).length;
      }
    }

    return { totEvents, totGroups, totTeams, totMatches };
  };

  const metrics = getSummaryMetrics();

  return (
    <div className="space-y-6" id="export-manager-root">
      
      {/* Tiêu đề & Giới thiệu */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-2 print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-955 text-blue-600 rounded-xl">
            <FileDown size={22} className="stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-zinc-905 dark:text-zinc-50 uppercase">
              Cổng Xuất File & In Ấn Dữ Liệu
            </h1>
            <p className="text-xs text-zinc-400">Xuất dữ liệu lịch thi đấu, tỷ số, bảng xếp hạng ra định dạng Excel siêu chuẩn hoặc in trực tiếp, lưu trữ PDF.</p>
          </div>
        </div>
      </div>

      {/* Cấu hình dữ liệu chọn lọc để xuất */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
        
        {/* Cột trái: Bộ chọn và thông số */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4">
            <div className="border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                <Layers size={14} /> 1. Chọn nội dung muốn xuất file
              </h3>
            </div>

            {/* Các Pills Nội dung */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setSelectedEventFilter('all');
                  setExportSuccess(false);
                }}
                className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer select-none flex items-center gap-1.5 ${
                  selectedEventFilter === 'all'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-xs font-extrabold'
                    : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-850 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Trophy size={13} />
                <span>Toàn bộ giải đấu</span>
              </button>

              {eventList.map((evt) => (
                <button
                  key={evt.id}
                  onClick={() => {
                    setSelectedEventFilter(evt.id);
                    setExportSuccess(false);
                  }}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer select-none flex items-center gap-1.5 ${
                    selectedEventFilter === evt.id
                      ? 'bg-blue-600 border-blue-600 text-white shadow-xs font-extrabold'
                      : 'bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-850 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  <ChevronRight size={12} className={selectedEventFilter === evt.id ? 'text-white' : 'text-zinc-350'} />
                  <span>{evt.name}</span>
                </button>
              ))}
            </div>

            {/* Thống kê gói dữ liệu xuất */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-zinc-50 dark:bg-zinc-950 p-4 rounded-xl border border-zinc-150/50 dark:border-zinc-850">
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Số nội dung</span>
                <p className="text-base font-black text-blue-600 dark:text-blue-400">{metrics.totEvents}</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Tổng số đội</span>
                <p className="text-base font-black text-zinc-700 dark:text-zinc-200">{metrics.totTeams}</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Tổng số bảng</span>
                <p className="text-base font-black text-zinc-700 dark:text-zinc-200">{metrics.totGroups}</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Tổng số trận</span>
                <p className="text-base font-black text-emerald-600 dark:text-emerald-400">{metrics.totMatches}</p>
              </div>
            </div>
          </div>

          {/* Các nút hành động chính */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Thẻ Xuất Excel */}
            <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
                    <FileSpreadsheet size={18} />
                  </div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-100">Bản xuất Excel chuyên nghiệp</h4>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Xuất dữ liệu lịch thi đấu, tỷ số trận đấu, và kết quả bảng xếp hạng hiện tại ra file <strong>.xlsx</strong>. File Excel được cấu hình sẵn đường lưới, căn lề và định dạng phông chữ chân thực (Times New Roman) theo biểu mẫu quy chuẩn của BTC.
                </p>
              </div>

              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 mt-4">
                <button
                  onClick={handleExportLiveExcel}
                  disabled={isExportingExcel}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all uppercase tracking-wider disabled:opacity-50 select-none hover:scale-[1.01]"
                >
                  <FileSpreadsheet size={15} />
                  <span>{isExportingExcel ? 'Đang xuất file Excel...' : 'Tải xuống File Excel'}</span>
                </button>
              </div>
            </div>

            {/* Thẻ In ấn/PDF */}
            <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
                    <Printer size={18} />
                  </div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-100">In trực tiếp / Lưu trữ PDF</h4>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Mở giao diện in ấn truyền thống tích hợp sẵn trên trình duyệt. Bạn có thể in trực tiếp ra khổ giấy <strong>A4</strong>, hoặc lưu lại dưới dạng file <strong>PDF</strong> chất lượng cao. Tất cả thanh điều khiển và logo điều hướng sẽ tự động được ẩn tối ưu.
                </p>
              </div>

              {/* Tùy chọn phạm vi In dữ liệu */}
              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-150 dark:border-zinc-850 space-y-2.5">
                <label className="flex items-start gap-2 text-[11px] font-black text-zinc-700 dark:text-zinc-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={printOnlyMatches}
                    onChange={(e) => setPrintOnlyMatches(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer h-3.5 w-3.5"
                  />
                  <span>Chỉ lấy dữ liệu Lịch thi đấu & Kết quả (Ẩn Bảng xếp hạng)</span>
                </label>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed pl-5">
                  Khi bật (mặc định), hệ thống sẽ ẩn phần bảng xếp hạng vòng bảng để bản in/PDF <strong>chỉ lấy dữ liệu từ trang lịch thi đấu đến hết</strong>.
                </p>
              </div>

              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 mt-2 space-y-3">
                <button
                  onClick={() => {
                    try {
                      window.focus();
                      window.print();
                    } catch (e) {
                      console.warn('In trực tiếp thất bại trong iframe:', e);
                    }
                  }}
                  className="w-full py-3 bg-[#0c7d5d] hover:bg-[#0c7d5d]/90 text-white font-extrabold rounded-[14px] text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all uppercase tracking-wider select-none hover:scale-[1.01]"
                >
                  <Printer size={15} />
                  <span>Mở Trình In / Lưu PDF</span>
                </button>

                {window.self !== window.top && (
                  <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-xl space-y-1">
                    <p className="text-[10.5px] text-amber-850 dark:text-amber-400 font-bold leading-relaxed flex items-start gap-1">
                      <span className="shrink-0 text-amber-500">⚠️</span>
                      <span>Bạn đang sử dụng khung xem thử (iFrame). Trực tiếp bấm "In" có thể bị trình duyệt hạn chế. Hãy bấm <strong>"Mở trong tab mới" (Open in new tab)</strong> ở thanh công cụ góc trên để in ấn / lưu PDF mượt mà nhất!</span>
                    </p>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Feedback Trạng thái thành công */}
          {exportSuccess && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-250/50 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-350 text-xs font-bold flex items-center gap-2.5 shadow-xs animate-fade-in">
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span>Xuất tập tin thành công! File đã được lưu tự động về thư mục tải xuống thiết bị của bạn.</span>
            </div>
          )}
        </div>

        {/* Cột phải: Hướng dẫn - Gợi ý in ấn */}
        <div className="space-y-5">
          
          <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4">
            <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-1.5">
              <Info size={14} className="text-blue-500" /> Hướng dẫn in ấn đẹp nhất
            </h3>

            <div className="space-y-3.5 text-[11px] text-zinc-450 dark:text-zinc-400 leading-relaxed">
              <div className="flex gap-2.5">
                <span className="h-4 w-4 bg-zinc-100 dark:bg-zinc-950 text-zinc-650 flex items-center justify-center rounded text-[9px] font-bold shrink-0">1</span>
                <p>Nên chọn khổ giấy <strong>A4</strong>, định dạng <strong>Ngang (Landscape)</strong> đối với sơ đồ thi đấu hoặc <strong>Dọc (Portrait)</strong> đối với bảng xếp hạng standings.</p>
              </div>
              <div className="flex gap-2.5">
                <span className="h-4 w-4 bg-zinc-100 dark:bg-zinc-950 text-zinc-650 flex items-center justify-center rounded text-[9px] font-bold shrink-0">2</span>
                <p>Bật tùy chọn <strong>"Background graphics"</strong> (Đồ họa nền) trong cài đặt in của Chrome hoặc Edge để giữ nguyên màu sắc ô rực rỡ và độ phân giải rõ nét.</p>
              </div>
              <div className="flex gap-2.5">
                <span className="h-4 w-4 bg-zinc-100 dark:bg-zinc-950 text-zinc-650 flex items-center justify-center rounded text-[9px] font-bold shrink-0">3</span>
                <p>Mẹo nhỏ: Có thể xuất sẵn file Excel sau đó định dạng thêm biểu mẫu riêng biệt hoặc sao chép dễ dàng vào báo cáo tổng kết của BTC.</p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-5 rounded-2xl text-white space-y-3 shadow-md relative overflow-hidden">
            <div className="absolute right-[-10px] bottom-[-10px] text-white/5 pointer-events-none">
              <Sparkles size={110} />
            </div>
            
            <h4 className="text-xs font-black uppercase tracking-wider flex items-center gap-1">
              <Sparkles size={13} className="text-amber-300 animate-pulse" />
              Tính Năng Tự Động Định Dạng
            </h4>
            <p className="text-[10.5px] text-blue-100 leading-relaxed">
              Hệ thống tự động phân loại những trận vừa kết thúc, sắp diễn ra hay sơ đồ phân nhánh để xếp gọn vào các trang tính riêng biệt, giúp BTC không cần thao tác gộp thủ công tẻ nhạt.
            </p>
          </div>

        </div>

      </div>

      {/* KHU VỰC BẢN XEM TRƯỚC HÌNH ẢNH TRƯỚC KHI IN (PRINT PREVIEW AREA) */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4 print:border-none print:p-0 print:bg-transparent print:space-y-0">
        <div className="border-b border-zinc-100 dark:border-zinc-800 pb-3 flex items-center justify-between print:hidden">
          <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
            <CalendarDays size={14} /> 2. Bản xem trước nội dung in ấn
          </h3>
          <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-650 px-2.5 py-0.5 rounded-full font-bold">CHUẨN TÀI LIỆU A4 PRINT</span>
        </div>

        {/* Render trực tiếp dữ liệu dạng tài liệu in ấn sắc nét để xem trước */}
        {(() => {
          let eventsToRender: any[] = [];
          if (selectedEventFilter === 'all') {
            eventsToRender = Object.values(events || {});
          } else {
            const single = events[selectedEventFilter];
            if (single) eventsToRender = [single];
          }

          if (eventsToRender.length === 0) {
            return <p className="text-xs text-zinc-400 py-10 text-center">Không có dữ liệu hiển thị xem trước.</p>;
          }

          return (
            <div className="space-y-8 bg-zinc-50/50 dark:bg-zinc-950/30 p-4 sm:p-6 rounded-xl border border-zinc-100 dark:border-zinc-800 max-h-[500px] overflow-y-auto print:max-h-none print:overflow-visible print:border-none print:p-0 print:bg-transparent">
              {eventsToRender.map((evt) => {
                const stdByGrp = getEventStandings(evt);
                const evtGroups = Object.values(evt.groups || {});
                const evtMatches = evt.matches || [];

                return (
                  <div key={evt.id} className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-zinc-200/60 dark:border-zinc-800 space-y-5 shadow-xs break-after-page">
                    <div className="text-center pb-2 border-b-2 border-zinc-900 dark:border-white">
                      <h2 className="text-sm font-black uppercase text-zinc-900 dark:text-white">
                        LỊCH ĐẤU & KẾT QUẢ - {evt.name}
                      </h2>
                      <p className="text-[10px] text-zinc-400 italic mt-0.5">
                        Giải đấu: {tournament.name} | BTC: {tournament.organization} | Sân: {tournament.location}
                      </p>
                    </div>

                    {/* Vòng bảng */}
                    {!printOnlyMatches && (
                      <div className="space-y-3">
                        <h3 className="text-xs font-bold uppercase text-zinc-805 dark:text-zinc-200 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-600"></span>
                          Bảng xếp hạng vòng bảng
                        </h3>
                        {evtGroups.length === 0 ? (
                          <p className="text-[11px] text-zinc-400 italic pl-3">Nội dung này không chia bảng.</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {evtGroups.map((group: any) => {
                              const std = stdByGrp[group.id] || [];
                              return (
                                <div key={group.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                                  <div className="bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800">
                                    <span className="text-[11px] font-black uppercase text-blue-600 dark:text-blue-400">{group.name}</span>
                                  </div>
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 text-[10px] text-zinc-400 font-bold">
                                        <th className="px-3 py-1.5 text-center w-12">Hạng</th>
                                        <th className="px-3 py-1.5">Đội / VĐV</th>
                                        <th className="px-3 py-1.5 text-center w-16">Số trận</th>
                                        <th className="px-3 py-1.5 text-right w-16">Điểm</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {std.map((s, idx) => (
                                        <tr key={s.teamId} className="border-b border-zinc-150/50 dark:border-zinc-850 text-[11px] hover:bg-zinc-50/30">
                                          <td className="px-3 py-1.5 text-center font-bold text-zinc-400">{idx + 1}</td>
                                          <td className="px-3 py-1.5 font-bold text-zinc-700 dark:text-zinc-300">{s.teamName}</td>
                                          <td className="px-3 py-1.5 text-center text-zinc-450">{s.matchesPlayed}</td>
                                          <td className="px-3 py-1.5 text-right font-black text-blue-600">{s.points}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Danh sách trận đấu */}
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold uppercase text-zinc-805 dark:text-zinc-200 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
                        Tiến trình thi đấu giải đấu
                      </h3>
                      {evtMatches.length === 0 ? (
                        <p className="text-[11px] text-zinc-400 italic pl-3">Chưa thiết lập trận đấu nào.</p>
                      ) : (
                        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                          <table className="w-full text-left border-collapse text-[10.5px]">
                            <thead>
                              <tr className="bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 font-bold uppercase">
                                <th className="px-3 py-2 text-center w-10">STT</th>
                                <th className="px-3 py-2 w-28">Nội Dung</th>
                                <th className="px-3 py-2 w-24">Vòng Đấu</th>
                                <th className="px-3 py-2 text-right">Đội tuyển A</th>
                                <th className="px-3 py-2 text-center w-20">Tỷ số</th>
                                <th className="px-3 py-2">Đội tuyển B</th>
                                <th className="px-3 py-2 text-center w-24">Kết quả</th>
                              </tr>
                            </thead>
                            <tbody>
                              {evtMatches.map((m, mIdx) => {
                                const tAName = evt.teams[m.teamAId]?.name || getReadableTeamName(m.teamAId, evt.groups);
                                const tBName = evt.teams[m.teamBId]?.name || getReadableTeamName(m.teamBId, evt.groups);
                                let gLabel = 'Vòng loại trực tiếp';
                                if (m.groupId !== 'knockout') {
                                  const grpo = evt.groups[m.groupId];
                                  gLabel = grpo ? grpo.name : `Bảng ${m.groupId}`;
                                }
                                let rLabel = `Vòng ${m.round}`;
                                if (m.groupId === 'knockout') {
                                  rLabel = m.knockoutRoundName || 'Trực tiếp';
                                }
                                const scText = m.status === 'finished' ? `${m.scoreA} - ${m.scoreB}` : 'Chờ đấu';
                                let stText = 'Chưa đấu';
                                if (m.status === 'finished') {
                                  stText = m.scoreA! > m.scoreB! ? 'Thắng' : m.scoreB! > m.scoreA! ? 'Thua' : 'Hòa';
                                }

                                return (
                                  <tr key={m.id} className="border-b border-zinc-150/50 dark:border-zinc-850 hover:bg-zinc-50/30">
                                    <td className="px-3 py-2 text-center text-zinc-400">{mIdx + 1}</td>
                                    <td className="px-3 py-2 font-medium text-zinc-500">{gLabel}</td>
                                    <td className="px-3 py-2 font-medium text-zinc-500">{rLabel}</td>
                                    <td className="px-3 py-2 text-right font-bold text-zinc-700 dark:text-zinc-300">{tAName}</td>
                                    <td className="px-3 py-2 text-center font-mono font-black text-blue-600 bg-zinc-50/[0.04] p-1 rounded select-none">{scText}</td>
                                    <td className="px-3 py-2 font-bold text-zinc-700 dark:text-zinc-300">{tBName}</td>
                                    <td className={`px-3 py-2 text-center font-bold ${m.status === 'finished' ? 'text-emerald-600' : 'text-zinc-400'}`}>{stText}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

    </div>
  );
}
