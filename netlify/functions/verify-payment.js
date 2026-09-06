import { getStore } from "@netlify/blobs";

export default async (req) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Method not allowed"
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  try {
    // Check that the Flutterwave secret key exists
    const secretKey = process.env.FLW_SECRET_KEY;

    if (!secretKey) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Flutterwave secret key is not configured."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Read request body
    const body = await req.json();

    const transactionId = body.transaction_id;
    const txRef = body.tx_ref;
    const service = body.service;

    // Validate required information
    if (!transactionId || !txRef || !service) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Missing payment verification information."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Only allow the two existing services
    const allowedServices = {
      "Celebration Announcement Only": 3000,
      "Celebration Phone Call Interview": 7000
    };

    const expectedAmount = allowedServices[service];

    if (!expectedAmount) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid service selected."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Verify transaction directly with Flutterwave
    const flutterwaveResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(
        transactionId
      )}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    const flutterwaveData = await flutterwaveResponse.json();

    // Make sure Flutterwave returned a valid response
    if (!flutterwaveResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            flutterwaveData?.message ||
            "Unable to verify payment with Flutterwave."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const transaction = flutterwaveData?.data;

    if (!transaction) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Flutterwave returned no transaction data."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Check payment status
    if (transaction.status !== "successful") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Payment was not successful."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Check currency
    if (transaction.currency !== "NGN") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid payment currency."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Check amount
    if (Number(transaction.amount) < Number(expectedAmount)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Payment amount is less than the required amount."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Check transaction reference
    if (transaction.tx_ref !== txRef) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Transaction reference does not match."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    /*
     * PAYMENT HAS NOW BEEN VERIFIED.
     *
     * Save the verified payment into Netlify Blobs.
     *
     * This is a site-wide store, so the data remains available
     * across new deployments.
     */
    const store = getStore("kulzzy-celebration-requests");

    const requestRecord = {
      paymentStatus: "PAID",

      transactionId: String(transaction.id || transactionId),

      txRef: String(transaction.tx_ref || txRef),

      service: service,

      amountPaid: Number(transaction.amount),

      currency: transaction.currency,

      paymentStatusFromFlutterwave: transaction.status,

      paidAt:
        transaction.created_at ||
        transaction.completed_at ||
        new Date().toISOString(),

      verifiedAt: new Date().toISOString(),

      paymentProcessor: "Flutterwave"
    };

    /*
     * Use the transaction reference as the record key.
     *
     * If Flutterwave calls verification again for the same
     * transaction, the same record is updated instead of
     * creating another duplicate payment record.
     */
    await store.setJSON(
      `requests/${String(txRef)}`,
      requestRecord
    );

    // Return successful verification result to the frontend
    return new Response(
      JSON.stringify({
        success: true,

        message: "Payment verified successfully.",

        transaction_id: transaction.id,

        tx_ref: transaction.tx_ref,

        amount: transaction.amount,

        currency: transaction.currency,

        service: service,

        paymentStatus: "PAID"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);

    return new Response(
      JSON.stringify({
        success: false,
        message: "An error occurred while verifying the payment."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
};
