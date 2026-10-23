# Error Contract

**Version:** 1.0 · Every error, everywhere, uses this shape.

```json
{ "error": { "code": "insufficient_stock",
             "message": "الرصيد غير كافٍ من هذا الصنف",
             "field": "lines[0].net_kg",
             "retryable": false,
             "details": { "material": "نحاس أحمر", "required_kg": "500.00", "available_kg": "300.00" } } }
```

**Rules.** `code` is machine-readable and stable (never localized). `message` is Arabic, plain, and tells the user
what to do — never a stack trace, never a raw database message. `field` points at the offending input where one
exists. `retryable` tells the client whether an automatic retry is meaningful. `details` never contains a secret,
another yard's data, or an internal identifier that is not the user's own.

| Code | HTTP | Arabic message | Retryable | Audited |
|---|---|---|---|---|
| `unauthenticated` | 401 | يجب تسجيل الدخول | no | yes |
| `unauthorized_capability` | 403 | هذه العملية تحتاج صلاحية المالك | no | **yes** |
| `forged_tenant_context` | 403 | طلب غير صالح | no | **yes, as a security event** |
| `account_locked` | 423 | الحساب مقفل مؤقتًا. حاول بعد ١٥ دقيقة | no | yes |
| `rate_limited` | 429 | محاولات كثيرة. انتظر قليلًا | **yes, after delay** | yes |
| `invalid_weight` | 422 | وزن غير صالح | no | no |
| `invalid_deduction` | 422 | الخصم أكبر من أو يساوي الوزن القائم | no | no |
| `invalid_price_unit` | 422 | وحدة السعر غير صالحة | no | no |
| `implausible_value` | 409 | الرقم يبدو غير منطقي — أكّد للمتابعة | no (needs confirmation) | yes |
| `insufficient_stock` | 409 | الرصيد غير كافٍ من هذا الصنف | no | yes |
| `stock_would_go_negative` | 409 | العملية ستجعل الرصيد بالسالب | no | yes |
| `regrade_weight_mismatch` | 422 | مجموع النواتج لا يساوي الكمية المستهلكة | no | no |
| `missing_reference_price` | 409 | صنف ناتج بلا سعر مرجعي — أدخل قيمة أو أجّل التوزيع | no | no |
| `pending_day_close_blocker` | 409 | لا يمكن تقفيل اليوم — توجد عمليات أو مبالغ معلقة | no | yes |
| `day_closed_immutable` | 409 | اليوم مقفول ولا يمكن التعديل عليه | no | yes |
| `pending_cash_unresolved` | 409 | يجب تحديد مصير المبلغ المستلم | no | yes |
| `duplicate_payment_suspected` | 409 | يوجد سداد مماثل خلال آخر خمس دقائق. أكّد فقط إذا كان مستقلاً. | no (explicit confirmation only) | no — it makes no mutation; a later confirmed payment has its own audit row |
| `duplicate_idempotency_key` | 200 | *(not an error — the original result is returned)* | n/a | no |
| `stale_reference` | 409 | تغيّرت البيانات — أعد التحميل | yes | no |
| `party_required` | 422 | يجب اختيار المورد أو العميل | no | no |
| `material_inactive` | 422 | هذا الصنف غير مفعّل | no | no |
| `validation_failed` | 422 | بيانات غير مكتملة | no | no |
| `conflict` | 409 | تعارض في البيانات | yes | yes |
| `internal_error` | 500 | حدث خطأ غير متوقع. أعد المحاولة من الشاشة نفسها ولا تُدخل العملية من جديد. | yes | **yes, with a trace id** |
| `service_unavailable` | 503 | الخدمة غير متاحة مؤقتًا. لا يمكن تأكيد حفظ العملية الآن. | **yes** | yes |

**Never leaked in an error:** SQL text · table or column names · stack traces · another yard's data · a PIN, hash,
token or secret · the existence of a `yard_id` the caller may not see (return the same 403 either way).

**Client rule:** `retryable: false` must never be retried automatically. `retryable: true` retries with exponential
backoff, carrying the **same** idempotency key.
