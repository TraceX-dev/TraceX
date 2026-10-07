//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Email wording per language. Kept in code rather than in plugin lang files because the
// transactor registers only English strings for platform plugins.

import { defaultEmailStrings, type EmailStrings } from './content'

const ru: EmailStrings = {
  titleMention: '{sender} упомянул(а) вас в {object}',
  titleReply: '{sender} ответил(а) в {object}',
  titleReplyOwn: '{sender} ответил(а) на ваше сообщение в {object}',
  titleMessage: 'Новое сообщение в {object}',
  titleReaction: '{sender} отреагировал(а) {emoji} на ваше сообщение в {object}',
  titleUpdate: '{object}: есть изменения',
  titleCreate: '{object}: создано',
  titleAssignment: '{sender} назначил(а) вам {object}',
  titleAssignmentNoSender: 'Вам назначено: {object}',
  titleCoAuthor: '{sender} добавил(а) вас в соавторы {object}',
  titleCoAuthorNoSender: 'Вас добавили в соавторы {object}',
  titleRequest: 'Требуется действие: {object}',
  quoteOwn: 'Ваше сообщение',
  quoteOther: '{author} пишет',
  quoteAnonymous: 'Исходное сообщение',
  actionReply: 'Ответить в {app}',
  actionOpen: 'Открыть в {app}',
  readMore: 'Полный текст сообщения — в {app}',
  reason: 'Вы получили это письмо, потому что подписаны на такие уведомления в рабочем пространстве {workspace}.',
  notificationSettings: 'Настройки уведомлений',
  copyright: '© {app} — Все права защищены'
}

const de: EmailStrings = {
  titleMention: '{sender} hat Sie in {object} erwähnt',
  titleReply: '{sender} hat in {object} geantwortet',
  titleReplyOwn: '{sender} hat in {object} auf Ihre Nachricht geantwortet',
  titleMessage: 'Neue Nachricht in {object}',
  titleReaction: '{sender} hat in {object} mit {emoji} auf Ihre Nachricht reagiert',
  titleUpdate: '{object} wurde aktualisiert',
  titleCreate: '{object} wurde erstellt',
  titleAssignment: '{sender} hat Ihnen {object} zugewiesen',
  titleAssignmentNoSender: '{object} wurde Ihnen zugewiesen',
  titleCoAuthor: '{sender} hat Sie als Mitautor von {object} hinzugefügt',
  titleCoAuthorNoSender: 'Sie wurden als Mitautor von {object} hinzugefügt',
  titleRequest: 'Aktion erforderlich: {object}',
  quoteOwn: 'Ihre Nachricht',
  quoteOther: '{author} schrieb',
  quoteAnonymous: 'Ursprüngliche Nachricht',
  actionReply: 'In {app} antworten',
  actionOpen: 'In {app} öffnen',
  readMore: 'Die vollständige Nachricht finden Sie in {app}',
  reason:
    'Sie erhalten diese E-Mail, weil Sie diese Art von Benachrichtigungen im Arbeitsbereich {workspace} abonniert haben.',
  notificationSettings: 'Benachrichtigungseinstellungen',
  copyright: '© {app} — Alle Rechte vorbehalten'
}

const fr: EmailStrings = {
  titleMention: '{sender} vous a mentionné dans {object}',
  titleReply: '{sender} a répondu dans {object}',
  titleReplyOwn: '{sender} a répondu à votre message dans {object}',
  titleMessage: 'Nouveau message dans {object}',
  titleReaction: '{sender} a réagi {emoji} à votre message dans {object}',
  titleUpdate: '{object} a été mis à jour',
  titleCreate: '{object} a été créé',
  titleAssignment: '{sender} vous a assigné {object}',
  titleAssignmentNoSender: '{object} vous a été assigné',
  titleCoAuthor: '{sender} vous a ajouté comme co-auteur de {object}',
  titleCoAuthorNoSender: 'Vous avez été ajouté comme co-auteur de {object}',
  titleRequest: 'Action requise : {object}',
  quoteOwn: 'Votre message',
  quoteOther: '{author} a écrit',
  quoteAnonymous: 'Message d’origine',
  actionReply: 'Répondre dans {app}',
  actionOpen: 'Ouvrir dans {app}',
  readMore: 'Lire le message complet dans {app}',
  reason:
    'Vous recevez cet e-mail parce que vous êtes abonné à ce type de notification dans l’espace de travail {workspace}.',
  notificationSettings: 'Paramètres de notification',
  copyright: '© {app} — Tous droits réservés'
}

const es: EmailStrings = {
  titleMention: '{sender} te ha mencionado en {object}',
  titleReply: '{sender} ha respondido en {object}',
  titleReplyOwn: '{sender} ha respondido a tu mensaje en {object}',
  titleMessage: 'Nuevo mensaje en {object}',
  titleReaction: '{sender} ha reaccionado con {emoji} a tu mensaje en {object}',
  titleUpdate: '{object} se ha actualizado',
  titleCreate: '{object} se ha creado',
  titleAssignment: '{sender} te ha asignado {object}',
  titleAssignmentNoSender: 'Se te ha asignado {object}',
  titleCoAuthor: '{sender} te ha añadido como coautor de {object}',
  titleCoAuthorNoSender: 'Se te ha añadido como coautor de {object}',
  titleRequest: 'Acción requerida: {object}',
  quoteOwn: 'Tu mensaje',
  quoteOther: '{author} escribió',
  quoteAnonymous: 'Mensaje original',
  actionReply: 'Responder en {app}',
  actionOpen: 'Abrir en {app}',
  readMore: 'Lee el mensaje completo en {app}',
  reason:
    'Recibes este correo porque estás suscrito a este tipo de notificaciones en el espacio de trabajo {workspace}.',
  notificationSettings: 'Configuración de notificaciones',
  copyright: '© {app} — Todos los derechos reservados'
}

const it: EmailStrings = {
  titleMention: '{sender} ti ha menzionato in {object}',
  titleReply: '{sender} ha risposto in {object}',
  titleReplyOwn: '{sender} ha risposto al tuo messaggio in {object}',
  titleMessage: 'Nuovo messaggio in {object}',
  titleReaction: '{sender} ha reagito con {emoji} al tuo messaggio in {object}',
  titleUpdate: '{object} è stato aggiornato',
  titleCreate: '{object} è stato creato',
  titleAssignment: '{sender} ti ha assegnato {object}',
  titleAssignmentNoSender: '{object} ti è stato assegnato',
  titleCoAuthor: '{sender} ti ha aggiunto come coautore di {object}',
  titleCoAuthorNoSender: 'Sei stato aggiunto come coautore di {object}',
  titleRequest: 'Azione richiesta: {object}',
  quoteOwn: 'Il tuo messaggio',
  quoteOther: '{author} ha scritto',
  quoteAnonymous: 'Messaggio originale',
  actionReply: 'Rispondi in {app}',
  actionOpen: 'Apri in {app}',
  readMore: 'Leggi il messaggio completo in {app}',
  reason: 'Ricevi questa email perché sei iscritto a questo tipo di notifiche nello spazio di lavoro {workspace}.',
  notificationSettings: 'Impostazioni di notifica',
  copyright: '© {app} — Tutti i diritti riservati'
}

const pt: EmailStrings = {
  titleMention: '{sender} mencionou-o em {object}',
  titleReply: '{sender} respondeu em {object}',
  titleReplyOwn: '{sender} respondeu à sua mensagem em {object}',
  titleMessage: 'Nova mensagem em {object}',
  titleReaction: '{sender} reagiu com {emoji} à sua mensagem em {object}',
  titleUpdate: '{object} foi atualizado',
  titleCreate: '{object} foi criado',
  titleAssignment: '{sender} atribuiu-lhe {object}',
  titleAssignmentNoSender: '{object} foi-lhe atribuído',
  titleCoAuthor: '{sender} adicionou-o como coautor de {object}',
  titleCoAuthorNoSender: 'Foi adicionado como coautor de {object}',
  titleRequest: 'Ação necessária: {object}',
  quoteOwn: 'A sua mensagem',
  quoteOther: '{author} escreveu',
  quoteAnonymous: 'Mensagem original',
  actionReply: 'Responder no {app}',
  actionOpen: 'Abrir no {app}',
  readMore: 'Leia a mensagem completa no {app}',
  reason: 'Está a receber este email porque subscreveu este tipo de notificações no espaço de trabalho {workspace}.',
  notificationSettings: 'Definições de notificação',
  copyright: '© {app} — Todos os direitos reservados'
}

const ptBr: EmailStrings = {
  titleMention: '{sender} mencionou você em {object}',
  titleReply: '{sender} respondeu em {object}',
  titleReplyOwn: '{sender} respondeu à sua mensagem em {object}',
  titleMessage: 'Nova mensagem em {object}',
  titleReaction: '{sender} reagiu com {emoji} à sua mensagem em {object}',
  titleUpdate: '{object} foi atualizado',
  titleCreate: '{object} foi criado',
  titleAssignment: '{sender} atribuiu {object} a você',
  titleAssignmentNoSender: '{object} foi atribuído a você',
  titleCoAuthor: '{sender} adicionou você como coautor de {object}',
  titleCoAuthorNoSender: 'Você foi adicionado como coautor de {object}',
  titleRequest: 'Ação necessária: {object}',
  quoteOwn: 'Sua mensagem',
  quoteOther: '{author} escreveu',
  quoteAnonymous: 'Mensagem original',
  actionReply: 'Responder no {app}',
  actionOpen: 'Abrir no {app}',
  readMore: 'Leia a mensagem completa no {app}',
  reason:
    'Você está recebendo este e-mail porque está inscrito neste tipo de notificação no espaço de trabalho {workspace}.',
  notificationSettings: 'Configurações de notificação',
  copyright: '© {app} — Todos os direitos reservados'
}

const cs: EmailStrings = {
  titleMention: '{sender} vás zmínil(a) v {object}',
  titleReply: '{sender} odpověděl(a) v {object}',
  titleReplyOwn: '{sender} odpověděl(a) na vaši zprávu v {object}',
  titleMessage: 'Nová zpráva v {object}',
  titleReaction: '{sender} reagoval(a) {emoji} na vaši zprávu v {object}',
  titleUpdate: '{object}: aktualizováno',
  titleCreate: '{object}: vytvořeno',
  titleAssignment: '{sender} vám přiřadil(a) {object}',
  titleAssignmentNoSender: 'Bylo vám přiřazeno: {object}',
  titleCoAuthor: '{sender} vás přidal(a) jako spoluautora {object}',
  titleCoAuthorNoSender: 'Byli jste přidáni jako spoluautor {object}',
  titleRequest: 'Vyžadována akce: {object}',
  quoteOwn: 'Vaše zpráva',
  quoteOther: '{author} napsal(a)',
  quoteAnonymous: 'Původní zpráva',
  actionReply: 'Odpovědět v {app}',
  actionOpen: 'Otevřít v {app}',
  readMore: 'Celou zprávu najdete v {app}',
  reason: 'Tento e-mail dostáváte, protože odebíráte tento typ oznámení v pracovním prostoru {workspace}.',
  notificationSettings: 'Nastavení oznámení',
  copyright: '© {app} — Všechna práva vyhrazena'
}

const pl: EmailStrings = {
  titleMention: '{sender} wspomniał(a) o Tobie w {object}',
  titleReply: '{sender} odpowiedział(a) w {object}',
  titleReplyOwn: '{sender} odpowiedział(a) na Twoją wiadomość w {object}',
  titleMessage: 'Nowa wiadomość w {object}',
  titleReaction: '{sender} zareagował(a) {emoji} na Twoją wiadomość w {object}',
  titleUpdate: '{object}: zaktualizowano',
  titleCreate: '{object}: utworzono',
  titleAssignment: '{sender} przypisał(a) Ci {object}',
  titleAssignmentNoSender: 'Przypisano Ci: {object}',
  titleCoAuthor: '{sender} dodał(a) Cię jako współautora {object}',
  titleCoAuthorNoSender: 'Dodano Cię jako współautora {object}',
  titleRequest: 'Wymagane działanie: {object}',
  quoteOwn: 'Twoja wiadomość',
  quoteOther: '{author} napisał(a)',
  quoteAnonymous: 'Oryginalna wiadomość',
  actionReply: 'Odpowiedz w {app}',
  actionOpen: 'Otwórz w {app}',
  readMore: 'Pełną wiadomość przeczytasz w {app}',
  reason: 'Otrzymujesz tę wiadomość, ponieważ subskrybujesz ten typ powiadomień w przestrzeni roboczej {workspace}.',
  notificationSettings: 'Ustawienia powiadomień',
  copyright: '© {app} — Wszystkie prawa zastrzeżone'
}

const tr: EmailStrings = {
  titleMention: '{sender} sizden şurada bahsetti: {object}',
  titleReply: '{sender} şurada yanıt verdi: {object}',
  titleReplyOwn: '{sender} mesajınıza şurada yanıt verdi: {object}',
  titleMessage: 'Yeni mesaj: {object}',
  titleReaction: '{sender} mesajınıza {emoji} ile tepki verdi: {object}',
  titleUpdate: '{object} güncellendi',
  titleCreate: '{object} oluşturuldu',
  titleAssignment: '{sender} size şunu atadı: {object}',
  titleAssignmentNoSender: 'Size atandı: {object}',
  titleCoAuthor: '{sender} sizi şunun ortak yazarı olarak ekledi: {object}',
  titleCoAuthorNoSender: 'Şunun ortak yazarı olarak eklendiniz: {object}',
  titleRequest: 'İşlem gerekli: {object}',
  quoteOwn: 'Mesajınız',
  quoteOther: '{author} yazdı',
  quoteAnonymous: 'Orijinal mesaj',
  actionReply: '{app} içinde yanıtla',
  actionOpen: '{app} içinde aç',
  readMore: 'Mesajın tamamını {app} içinde okuyun',
  reason: '{workspace} çalışma alanında bu tür bildirimlere abone olduğunuz için bu e-postayı alıyorsunuz.',
  notificationSettings: 'Bildirim ayarları',
  copyright: '© {app} — Tüm hakları saklıdır'
}

const zh: EmailStrings = {
  titleMention: '{sender} 在 {object} 中提到了您',
  titleReply: '{sender} 在 {object} 中回复了',
  titleReplyOwn: '{sender} 在 {object} 中回复了您的消息',
  titleMessage: '{object} 中有新消息',
  titleReaction: '{sender} 在 {object} 中用 {emoji} 回应了您的消息',
  titleUpdate: '{object} 已更新',
  titleCreate: '{object} 已创建',
  titleAssignment: '{sender} 将 {object} 分配给了您',
  titleAssignmentNoSender: '{object} 已分配给您',
  titleCoAuthor: '{sender} 将您添加为 {object} 的合著者',
  titleCoAuthorNoSender: '您已被添加为 {object} 的合著者',
  titleRequest: '需要您处理：{object}',
  quoteOwn: '您的消息',
  quoteOther: '{author} 写道',
  quoteAnonymous: '原始消息',
  actionReply: '在 {app} 中回复',
  actionOpen: '在 {app} 中打开',
  readMore: '在 {app} 中阅读完整消息',
  reason: '您收到此邮件，是因为您在 {workspace} 工作区订阅了此类通知。',
  notificationSettings: '通知设置',
  copyright: '© {app} — 保留所有权利'
}

const ja: EmailStrings = {
  titleMention: '{sender} さんが {object} であなたをメンションしました',
  titleReply: '{sender} さんが {object} で返信しました',
  titleReplyOwn: '{sender} さんが {object} であなたのメッセージに返信しました',
  titleMessage: '{object} に新しいメッセージがあります',
  titleReaction: '{sender} さんが {object} であなたのメッセージに {emoji} でリアクションしました',
  titleUpdate: '{object} が更新されました',
  titleCreate: '{object} が作成されました',
  titleAssignment: '{sender} さんが {object} をあなたに割り当てました',
  titleAssignmentNoSender: '{object} があなたに割り当てられました',
  titleCoAuthor: '{sender} さんがあなたを {object} の共著者に追加しました',
  titleCoAuthorNoSender: 'あなたは {object} の共著者に追加されました',
  titleRequest: '対応が必要です: {object}',
  quoteOwn: 'あなたのメッセージ',
  quoteOther: '{author} さんのメッセージ',
  quoteAnonymous: '元のメッセージ',
  actionReply: '{app} で返信',
  actionOpen: '{app} で開く',
  readMore: 'メッセージの全文は {app} で確認できます',
  reason: '{workspace} ワークスペースでこの種類の通知を購読しているため、このメールをお送りしています。',
  notificationSettings: '通知設定',
  copyright: '© {app} — 無断転載を禁じます'
}

const ko: EmailStrings = {
  titleMention: '{sender}님이 {object}에서 회원님을 언급했습니다',
  titleReply: '{sender}님이 {object}에 답글을 남겼습니다',
  titleReplyOwn: '{sender}님이 {object}에서 회원님의 메시지에 답글을 남겼습니다',
  titleMessage: '{object}의 새 메시지',
  titleReaction: '{sender}님이 {object}에서 회원님의 메시지에 {emoji} 반응을 남겼습니다',
  titleUpdate: '{object}이(가) 업데이트되었습니다',
  titleCreate: '{object}이(가) 생성되었습니다',
  titleAssignment: '{sender}님이 {object}을(를) 회원님에게 할당했습니다',
  titleAssignmentNoSender: '{object}이(가) 회원님에게 할당되었습니다',
  titleCoAuthor: '{sender}님이 회원님을 {object}의 공동 작성자로 추가했습니다',
  titleCoAuthorNoSender: '회원님이 {object}의 공동 작성자로 추가되었습니다',
  titleRequest: '조치 필요: {object}',
  quoteOwn: '회원님의 메시지',
  quoteOther: '{author}님의 메시지',
  quoteAnonymous: '원본 메시지',
  actionReply: '{app}에서 답글 달기',
  actionOpen: '{app}에서 열기',
  readMore: '{app}에서 전체 메시지 읽기',
  reason: '{workspace} 워크스페이스에서 이 유형의 알림을 구독하고 있어 이 이메일을 보내 드립니다.',
  notificationSettings: '알림 설정',
  copyright: '© {app} — 모든 권리 보유'
}

/**
 * Email wording by language code.
 * @public
 */
export const emailStrings: Record<string, EmailStrings> = {
  en: defaultEmailStrings,
  ru,
  de,
  fr,
  es,
  it,
  pt,
  'pt-br': ptBr,
  cs,
  pl,
  tr,
  zh,
  ja,
  ko
}

/**
 * Wording for a language: exact code ("pt-br"), then its base ("pt"), then English.
 * @public
 */
export function getEmailStrings (lang?: string): EmailStrings {
  const code = (lang ?? 'en').toLowerCase().replace('_', '-')
  return emailStrings[code] ?? emailStrings[code.split('-')[0]] ?? defaultEmailStrings
}
