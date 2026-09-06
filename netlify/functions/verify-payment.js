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
    // Get Flutterwave secret key from Netlify environment variables
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

    // Read payment information from the website
    const body = await req.json();

    const transactionId = body.transaction_id;
    const txRef = body.tx_ref;
    const service = body.service;

    // Validate required payment information
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

    // Allowed services and their official prices
    const servicePrices = {
      "Celebration Announcement Only": 3000,
      "Celebration Phone Call Interview": 7000
    };

    const expectedAmount = servicePrices[service];

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

    // Connect to the same Netlify Blobs store
    const store = getStore("kulzzy-celebration-requests");

    /*
     * Retrieve the celebration request that was saved
     * when create-payment.js created the payment.
     */
    const pendingRequest = await store.getJSON(
      `pending/${txRef}`
    );

    if (!pendingRequest) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            "The celebration request connected to this payment could not be found."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Make sure the saved service matches the payment request
    if (pendingRequest.service !== service) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Payment service does not match the request."
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
     * Verify the transaction directly with Flutterwave.
     */
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

    // Flutterwave verification request failed
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

    /*
     * PAYMENT STATUS CHECK
     */
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

    /*
     * CURRENCY CHECK
     */
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

    /*
     * AMOUNT CHECK
     */
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

    /*
     * TRANSACTION REFERENCE CHECK
     */
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
     * Make sure the transaction reference saved
     * with the request is also the same reference.
     */
    if (pendingRequest.txRef !== txRef) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Request transaction reference does not match."
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
     * EVERYTHING HAS NOW BEEN VERIFIED.
     *
     * Create the final celebration request record.
     */
    const finalRequest = {
      // Request information
      requestStatus: "PAID",

      service: pendingRequest.service,

      relationship: pendingRequest.relationship,

      category: pendingRequest.category,

      celebrantName: pendingRequest.celebrantName,

      celebrantPhone: pendingRequest.celebrantPhone,

      senderName: pendingRequest.senderName,

      whatsappNumber: pendingRequest.whatsappNumber,

      email: pendingRequest.email,

      writeup: pendingRequest.writeup,

      celebrationDate: pendingRequest.celebrationDate,

      // Payment information
      paymentStatus: "PAID",

      paymentProcessor: "Flutterwave",

      transactionId: String(
        transaction.id || transactionId
      ),

      txRef: String(
        transaction.tx_ref || txRef
      ),

      amountPaid: Number(transaction.amount),

      currency: transaction.currency,

      paymentStatusFromFlutterwave: transaction.status,

      paidAt:
        transaction.created_at ||
        transaction.completed_at ||
        new Date().toISOString(),

      verifiedAt: new Date().toISOString(),

      // Original request creation time
      createdAt:
        pendingRequest.createdAt ||
        new Date().toISOString()
    };

    /*
     * Save the FINAL PAID request.
     *
     * The transaction reference is used as the unique key.
     * This prevents the same payment from creating multiple
     * separate records.
     */
    await store.setJSON(
      `requests/${txRef}`,
      finalRequest
    );

    /*
     * Remove the temporary pending record.
     *
     * The final PAID record remains.
     */
    try {
      await store.delete(`pending/${txRef}`);
    } catch (deleteError) {
      console.error(
        "Unable to delete pending request:",
        deleteError
      );
    }

    /*
     * Tell the frontend that payment and request
     * processing were successful.
     */
    return new Response(
      JSON.stringify({
        success: true,

        message:
          "Payment verified and celebration request saved successfully.",

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
    console.error(
      "VERIFY PAYMENT ERROR:",
      error
    );

    return new Response(
      JSON.stringify({
        success: false,
        message:
          "An error occurred while verifying the payment."
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
