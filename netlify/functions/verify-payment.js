const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = "https://kulzzy.github.io";

const SERVICES = {
  "Celebration Announcement Only": 3000,
  "Celebration Phone Call Interview": 7000
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return response(200, { success: true });
  }

  if (event.httpMethod !== "POST") {
    return response(405, {
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    if (!process.env.FLW_SECRET_KEY) {
      return response(500, {
        success: false,
        message: "Flutterwave secret key is not configured."
      });
    }

    let data;

    try {
      data = JSON.parse(event.body || "{}");
    } catch (error) {
      return response(400, {
        success: false,
        message: "Invalid request data."
      });
    }

    const {
      transaction_id,
      tx_ref,
      service
    } = data;

    if (!transaction_id) {
      return response(400, {
        success: false,
        message: "Transaction ID is required."
      });
    }

    if (!tx_ref) {
      return response(400, {
        success: false,
        message: "Transaction reference is required."
      });
    }

    if (!service || !SERVICES[service]) {
      return response(400, {
        success: false,
        message: "Invalid service."
      });
    }

    const expectedAmount = SERVICES[service];

    const store = getStore({
      name: "kulzzy-celebration-requests",
      consistency: "strong"
    });

    const pendingRequest = await store.getJSON(`pending/${tx_ref}`);

    if (!pendingRequest) {
      return response(404, {
        success: false,
        message: "Payment request not found or has expired."
      });
    }

    if (pendingRequest.txRef !== tx_ref) {
      return response(400, {
        success: false,
        message: "Transaction reference does not match."
      });
    }

    if (pendingRequest.service !== service) {
      return response(400, {
        success: false,
        message: "Payment service does not match the request."
      });
    }

    const flutterwaveResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(
        transaction_id
      )}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let flutterwaveData;

    try {
      flutterwaveData = await flutterwaveResponse.json();
    } catch (error) {
      return response(502, {
        success: false,
        message: "Invalid response from Flutterwave."
      });
    }

    if (!flutterwaveResponse.ok) {
      console.error(
        "FLUTTERWAVE VERIFY ERROR:",
        JSON.stringify(flutterwaveData)
      );

      return response(400, {
        success: false,
        message: "Unable to verify payment with Flutterwave."
      });
    }

    const transaction = flutterwaveData.data;

    if (!transaction) {
      return response(400, {
        success: false,
        message: "Flutterwave returned no transaction data."
      });
    }

    if (transaction.status !== "successful") {
      return response(400, {
        success: false,
        message: "Payment was not successful."
      });
    }

    if (String(transaction.currency).toUpperCase() !== "NGN") {
      return response(400, {
        success: false,
        message: "Payment currency is not NGN."
      });
    }

    if (Number(transaction.amount) < expectedAmount) {
      return response(400, {
        success: false,
        message: "The payment amount is incorrect."
      });
    }

    if (transaction.tx_ref !== tx_ref) {
      return response(400, {
        success: false,
        message: "Flutterwave transaction reference does not match."
      });
    }

    const finalRequest = {
      requestStatus: "PAID",

      service: pendingRequest.service,
      relationship: pendingRequest.relationship,
      category: pendingRequest.category,

      celebrantName: pendingRequest.celebrantName,
      celebrantPhone: pendingRequest.celebrantPhone,

      senderName: pendingRequest.senderName,
      whatsappNumber: pendingRequest.whatsappNumber,

      writeup: pendingRequest.writeup,
      celebrationDate: pendingRequest.celebrationDate,

      paymentStatus: "PAID",
      paymentProcessor: "Flutterwave",

      transactionId: String(transaction.id),
      txRef: tx_ref,

      amountPaid: Number(transaction.amount),
      currency: transaction.currency,

      paymentStatusFromFlutterwave: transaction.status,

      paidAt:
        transaction.created_at ||
        transaction.paid_at ||
        new Date().toISOString(),

      verifiedAt: new Date().toISOString(),

      createdAt: pendingRequest.createdAt
    };

    await store.setJSON(`requests/${tx_ref}`, finalRequest);

    try {
      await store.delete(`pending/${tx_ref}`);
    } catch (deleteError) {
      console.error(
        "PENDING REQUEST DELETE ERROR:",
        deleteError
      );
    }

    return response(200, {
      success: true,
      message: "Payment verified successfully.",
      request: finalRequest
    });
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);

    return response(500, {
      success: false,
      message: "Unable to verify payment."
    });
  }
};
