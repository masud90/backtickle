// Material Symbols SVG icons (outlined, 400px)
// Imported with ?raw to load as strings for inline SVG rendering
// Strip outer <svg> tags to get only inner markup for composable rendering

import accessibilityNewSvg from '@material-symbols/svg-400/outlined/accessibility_new.svg?raw';
import addSvg from '@material-symbols/svg-400/outlined/add.svg?raw';
import addBoxSvg from '@material-symbols/svg-400/outlined/add_box.svg?raw';
import arrowDropDownSvg from '@material-symbols/svg-400/outlined/arrow_drop_down.svg?raw';
import arrowForwardSvg from '@material-symbols/svg-400/outlined/arrow_forward.svg?raw';
import checkSvg from '@material-symbols/svg-400/outlined/check.svg?raw';
import checkBoxSvg from '@material-symbols/svg-400/outlined/check_box.svg?raw';
import checkBoxOutlineBlankSvg from '@material-symbols/svg-400/outlined/check_box_outline_blank.svg?raw';
import checkCircleSvg from '@material-symbols/svg-400/outlined/check_circle.svg?raw';
import chevronRightSvg from '@material-symbols/svg-400/outlined/chevron_right.svg?raw';
import closeSvg from '@material-symbols/svg-400/outlined/close.svg?raw';
import cloudDoneSvg from '@material-symbols/svg-400/outlined/cloud_done.svg?raw';
import codeSvg from '@material-symbols/svg-400/outlined/code.svg?raw';
import codeBlocksSvg from '@material-symbols/svg-400/outlined/code_blocks.svg?raw';
import contentCopySvg from '@material-symbols/svg-400/outlined/content_copy.svg?raw';
import deleteSvg from '@material-symbols/svg-400/outlined/delete.svg?raw';
import descriptionSvg from '@material-symbols/svg-400/outlined/description.svg?raw';
import draftSvg from '@material-symbols/svg-400/outlined/draft.svg?raw';
import editSvg from '@material-symbols/svg-400/outlined/edit.svg?raw';
import editNoteSvg from '@material-symbols/svg-400/outlined/edit_note.svg?raw';
import errorSvg from '@material-symbols/svg-400/outlined/error.svg?raw';
import filterListSvg from '@material-symbols/svg-400/outlined/filter_list.svg?raw';
import folderSvg from '@material-symbols/svg-400/outlined/folder.svg?raw';
import folderOpenSvg from '@material-symbols/svg-400/outlined/folder_open.svg?raw';
import formatBoldSvg from '@material-symbols/svg-400/outlined/format_bold.svg?raw';
import formatItalicSvg from '@material-symbols/svg-400/outlined/format_italic.svg?raw';
import formatListBulletedSvg from '@material-symbols/svg-400/outlined/format_list_bulleted.svg?raw';
import formatListBulletedAddSvg from '@material-symbols/svg-400/outlined/format_list_bulleted_add.svg?raw';
import formatListNumberedSvg from '@material-symbols/svg-400/outlined/format_list_numbered.svg?raw';
import formatQuoteSvg from '@material-symbols/svg-400/outlined/format_quote.svg?raw';
import historySvg from '@material-symbols/svg-400/outlined/history.svg?raw';
import horizontalRuleSvg from '@material-symbols/svg-400/outlined/horizontal_rule.svg?raw';
import imageSvg from '@material-symbols/svg-400/outlined/image.svg?raw';
import infoSvg from '@material-symbols/svg-400/outlined/info.svg?raw';
import iosShareSvg from '@material-symbols/svg-400/outlined/ios_share.svg?raw';
import keyboardSvg from '@material-symbols/svg-400/outlined/keyboard.svg?raw';
import keyboardArrowDownSvg from '@material-symbols/svg-400/outlined/keyboard_arrow_down.svg?raw';
import keyboardArrowUpSvg from '@material-symbols/svg-400/outlined/keyboard_arrow_up.svg?raw';
import leftPanelCloseSvg from '@material-symbols/svg-400/outlined/left_panel_close.svg?raw';
import leftPanelOpenSvg from '@material-symbols/svg-400/outlined/left_panel_open.svg?raw';
import lightbulbSvg from '@material-symbols/svg-400/outlined/lightbulb.svg?raw';
import linkSvg from '@material-symbols/svg-400/outlined/link.svg?raw';
import moreHorizSvg from '@material-symbols/svg-400/outlined/more_horiz.svg?raw';
import reportSvg from '@material-symbols/svg-400/outlined/report.svg?raw';
import restartAltSvg from '@material-symbols/svg-400/outlined/restart_alt.svg?raw';
import saveSvg from '@material-symbols/svg-400/outlined/save.svg?raw';
import scheduleSvg from '@material-symbols/svg-400/outlined/schedule.svg?raw';
import searchSvg from '@material-symbols/svg-400/outlined/search.svg?raw';
import settingsSvg from '@material-symbols/svg-400/outlined/settings.svg?raw';
import strikethroughSSvg from '@material-symbols/svg-400/outlined/strikethrough_s.svg?raw';
import subjectSvg from '@material-symbols/svg-400/outlined/subject.svg?raw';
import syncSvg from '@material-symbols/svg-400/outlined/sync.svg?raw';
import syncDisabledSvg from '@material-symbols/svg-400/outlined/sync_disabled.svg?raw';
import tableChartSvg from '@material-symbols/svg-400/outlined/table_chart.svg?raw';
import textFieldsSvg from '@material-symbols/svg-400/outlined/text_fields.svg?raw';
import textSnippetSvg from '@material-symbols/svg-400/outlined/text_snippet.svg?raw';
import tuneSvg from '@material-symbols/svg-400/outlined/tune.svg?raw';
import unfoldMoreSvg from '@material-symbols/svg-400/outlined/unfold_more.svg?raw';
import verticalSplitSvg from '@material-symbols/svg-400/outlined/vertical_split.svg?raw';
import viewSidebarSvg from '@material-symbols/svg-400/outlined/view_sidebar.svg?raw';
import visibilitySvg from '@material-symbols/svg-400/outlined/visibility.svg?raw';
import warningSvg from '@material-symbols/svg-400/outlined/warning.svg?raw';
import zoomInSvg from '@material-symbols/svg-400/outlined/zoom_in.svg?raw';
import zoomOutSvg from '@material-symbols/svg-400/outlined/zoom_out.svg?raw';

// Strip outer <svg> tag to get only inner content
function stripSvgWrapper(svg: string): string {
  const match = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  return match?.[1] ?? svg;
}

export type IconName =
  | 'add'
  | 'description'
  | 'expand-more'
  | 'expand-less'
  | 'chevron-right'
  | 'cloud-done'
  | 'code-blocks'
  | 'save'
  | 'ios-share'
  | 'left-panel-open'
  | 'left-panel-close'
  | 'view-sidebar'
  | 'format-bold'
  | 'format-italic'
  | 'strikethrough-s'
  | 'code'
  | 'format-quote'
  | 'horizontal-rule'
  | 'format-list-bulleted'
  | 'format-list-numbered'
  | 'check-box'
  | 'check-box-outline-blank'
  | 'link'
  | 'image'
  | 'table-chart'
  | 'add-box'
  | 'edit-note'
  | 'delete'
  | 'edit'
  | 'text-snippet'
  | 'vertical-split'
  | 'visibility'
  | 'sync'
  | 'sync-disabled'
  | 'tune'
  | 'filter-list'
  | 'check-circle'
  | 'info'
  | 'lightbulb'
  | 'report'
  | 'warning'
  | 'error'
  | 'content-copy'
  | 'check'
  | 'schedule'
  | 'zoom-out'
  | 'zoom-in'
  | 'folder'
  | 'folder-open'
  | 'more-horiz'
  | 'search'
  | 'subject'
  | 'history'
  | 'arrow-forward'
  | 'draft'
  | 'unfold-more'
  | 'settings'
  | 'accessibility-new'
  | 'keyboard'
  | 'restart-alt'
  | 'arrow-drop-down'
  | 'close'
  | 'format-list-bulleted-add'
  | 'text-fields';

export const ICONS: Record<IconName, string> = {
  add: stripSvgWrapper(addSvg),
  description: stripSvgWrapper(descriptionSvg),
  'expand-more': stripSvgWrapper(keyboardArrowDownSvg),
  'expand-less': stripSvgWrapper(keyboardArrowUpSvg),
  'chevron-right': stripSvgWrapper(chevronRightSvg),
  'cloud-done': stripSvgWrapper(cloudDoneSvg),
  'code-blocks': stripSvgWrapper(codeBlocksSvg),
  save: stripSvgWrapper(saveSvg),
  'ios-share': stripSvgWrapper(iosShareSvg),
  'left-panel-open': stripSvgWrapper(leftPanelOpenSvg),
  'left-panel-close': stripSvgWrapper(leftPanelCloseSvg),
  'view-sidebar': stripSvgWrapper(viewSidebarSvg),
  'format-bold': stripSvgWrapper(formatBoldSvg),
  'format-italic': stripSvgWrapper(formatItalicSvg),
  'strikethrough-s': stripSvgWrapper(strikethroughSSvg),
  code: stripSvgWrapper(codeSvg),
  'format-quote': stripSvgWrapper(formatQuoteSvg),
  'horizontal-rule': stripSvgWrapper(horizontalRuleSvg),
  'format-list-bulleted': stripSvgWrapper(formatListBulletedSvg),
  'format-list-numbered': stripSvgWrapper(formatListNumberedSvg),
  'check-box': stripSvgWrapper(checkBoxSvg),
  'check-box-outline-blank': stripSvgWrapper(checkBoxOutlineBlankSvg),
  link: stripSvgWrapper(linkSvg),
  image: stripSvgWrapper(imageSvg),
  'table-chart': stripSvgWrapper(tableChartSvg),
  'add-box': stripSvgWrapper(addBoxSvg),
  'edit-note': stripSvgWrapper(editNoteSvg),
  delete: stripSvgWrapper(deleteSvg),
  edit: stripSvgWrapper(editSvg),
  'text-snippet': stripSvgWrapper(textSnippetSvg),
  'vertical-split': stripSvgWrapper(verticalSplitSvg),
  visibility: stripSvgWrapper(visibilitySvg),
  sync: stripSvgWrapper(syncSvg),
  'sync-disabled': stripSvgWrapper(syncDisabledSvg),
  tune: stripSvgWrapper(tuneSvg),
  'filter-list': stripSvgWrapper(filterListSvg),
  'check-circle': stripSvgWrapper(checkCircleSvg),
  info: stripSvgWrapper(infoSvg),
  lightbulb: stripSvgWrapper(lightbulbSvg),
  report: stripSvgWrapper(reportSvg),
  warning: stripSvgWrapper(warningSvg),
  error: stripSvgWrapper(errorSvg),
  'content-copy': stripSvgWrapper(contentCopySvg),
  check: stripSvgWrapper(checkSvg),
  schedule: stripSvgWrapper(scheduleSvg),
  'zoom-out': stripSvgWrapper(zoomOutSvg),
  'zoom-in': stripSvgWrapper(zoomInSvg),
  folder: stripSvgWrapper(folderSvg),
  'folder-open': stripSvgWrapper(folderOpenSvg),
  'more-horiz': stripSvgWrapper(moreHorizSvg),
  search: stripSvgWrapper(searchSvg),
  subject: stripSvgWrapper(subjectSvg),
  history: stripSvgWrapper(historySvg),
  'arrow-forward': stripSvgWrapper(arrowForwardSvg),
  draft: stripSvgWrapper(draftSvg),
  'unfold-more': stripSvgWrapper(unfoldMoreSvg),
  settings: stripSvgWrapper(settingsSvg),
  'accessibility-new': stripSvgWrapper(accessibilityNewSvg),
  keyboard: stripSvgWrapper(keyboardSvg),
  'restart-alt': stripSvgWrapper(restartAltSvg),
  'arrow-drop-down': stripSvgWrapper(arrowDropDownSvg),
  close: stripSvgWrapper(closeSvg),
  'format-list-bulleted-add': stripSvgWrapper(formatListBulletedAddSvg),
  'text-fields': stripSvgWrapper(textFieldsSvg),
};
